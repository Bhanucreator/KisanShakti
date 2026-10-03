"""
Hyperlocal Commerce Engine endpoints.

Routes prefixed /api/v1/ (mixed under /listings, /offers, /price-benchmarks
to keep URLs readable). Thin wrappers around commerce/calculations.py.

Key rules enforced here (not just in the UI):
  * Every listing-create and offer-create runs through validate_price().
    A client bypassing the mobile UI cannot post a price outside the ±5%
    AGMARKNET window.
  * Sold listings post an INCOME row to the linked Business cycle so the
    Generational BI feature auto-inherits the trade.
  * Offers auto-expire after 48h; a background cleanup runs opportunistically
    on every /offers list call (cheap, avoids needing a real scheduler).
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta
from typing import List, Literal, Optional

from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

import database
import models
from notifications import notify

# ── Reverse-geocode cache ───────────────────────────────────────────────────
# Nominatim (OSM) is free but rate-limited to 1 req/sec. We cache by lat/lng
# rounded to 3 decimals (~110 m precision) — plenty for identifying which
# village a farm is in, and it keeps our cache hit-rate high.
_geocode_cache: dict[str, str] = {}
_NOMINATIM_HEADERS = {
    # Nominatim's usage policy REQUIRES an identifying User-Agent.
    # https://operations.osmfoundation.org/policies/nominatim/
    "User-Agent": "KisanShakti/1.0 (dev@kisanshakti.in)",
}


def _reverse_geocode_village(lat: float, lng: float) -> Optional[str]:
    """
    Return the village / hamlet / suburb name for (lat, lng), or None on any
    failure (never raises — village is a nice-to-have on a listing, not a
    hard requirement).

    Nominatim returns a rich `address` object. We prefer the most specific
    field available, falling back through hamlet → village → suburb → town.
    """
    if lat is None or lng is None:
        return None
    key = f"{round(lat, 3)},{round(lng, 3)}"
    if key in _geocode_cache:
        return _geocode_cache[key]

    try:
        with httpx.Client(timeout=5.0, headers=_NOMINATIM_HEADERS) as c:
            r = c.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "lat": lat,
                    "lon": lng,
                    "format": "json",
                    "zoom": 14,           # village-level detail
                    "addressdetails": 1,
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        _geocode_cache[key] = ""            # negative cache so we don't retry hot
        return None

    addr = data.get("address", {}) or {}
    name = (
        addr.get("hamlet")
        or addr.get("village")
        or addr.get("suburb")
        or addr.get("town")
        or addr.get("city")
        or None
    )
    _geocode_cache[key] = name or ""
    return name or None

# Where uploaded listing photos live. Served publicly via /uploads/... in
# main.py (mounted with StaticFiles) so both farmer and buyer apps see them.
UPLOAD_DIR = Path(__file__).parent / "uploads" / "listings"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_PHOTO_BYTES = 5 * 1024 * 1024                # 5 MB after compression
from commerce.calculations import (
    BENCHMARK_TTL_HRS, DEFAULT_RADIUS_KM, OFFER_TTL_HOURS,
    ListingSnapshot, haversine_km, rank_listings, validate_price,
)
from dependencies import get_current_buyer, get_current_farmer
from rate_limit import check_rate
from crop_shelf_life import days_for as _shelf_days

router = APIRouter(prefix="/api/v1", tags=["commerce"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class ListingIn(BaseModel):
    crop_name:    str   = Field(..., min_length=1, max_length=64)
    crop_name_kn: Optional[str] = None
    quantity_kg:  float = Field(..., gt=0)
    price_per_kg: float = Field(..., gt=0)
    latitude:     float = Field(..., ge=-90,  le=90)
    longitude:    float = Field(..., ge=-180, le=180)
    plot_id:      Optional[str] = None
    cycle_id:     Optional[str] = None
    district:     Optional[str] = None
    expires_in_days: Optional[int] = Field(30, ge=1, le=90)
    # Optional auto-price-fit provenance — populated when the app pre-filled
    # the price from GET /pricing/suggest. Snapshotted onto the listing so
    # buyers can see the source ("Fitted from Bangarpet APMC · 13 km").
    market_source_apmc:        Optional[str]   = None
    market_source_district:    Optional[str]   = None
    market_source_price_kg:    Optional[float] = None
    market_source_distance_km: Optional[float] = None
    market_source_date:        Optional[str]   = None


class ListingUpdate(BaseModel):
    price_per_kg:  Optional[float] = Field(None, gt=0)
    quantity_kg:   Optional[float] = Field(None, ge=0)
    status:        Optional[Literal["AVAILABLE", "LOCKED", "SOLD"]] = None
    district:      Optional[str] = None


class OfferSummary(BaseModel):
    """Compact latest-offer projection for the farmer's dashboard cards."""
    id:                   str
    offered_price_per_kg: float
    quantity_kg:          float
    buyer_shop_name:      Optional[str]
    status:               str
    created_at:           datetime


class ListingPhotoOut(BaseModel):
    id:  str
    url: str


class ListingOut(BaseModel):
    id:              str
    listing_id:      Optional[str] = None  # Legacy support for frontend expecting 'listing_id' instead of 'id'
    farmer_id:       str
    farmer_name:     Optional[str]
    farmer_phone:    Optional[str]
    plot_id:         Optional[str]
    cycle_id:        Optional[str]
    crop_name:       str
    crop_name_kn:    Optional[str]
    quantity_kg:     float
    price_per_kg:    float
    status:          str
    latitude:        float
    longitude:       float
    distance_km:     Optional[float] = None
    benchmark_price: Optional[float] = None
    price_verified:  bool = False
    fair_price:      bool = False
    photo_url:       Optional[str]   = None
    # Full ordered list of photos (sort_order asc). Each entry has id + url —
    # the id is needed for DELETE /listings/{id}/photos/{photo_id}. The url
    # is a "/uploads/..." relative path, resolve with API_BASE. First entry's
    # url equals photo_url for backward compat with older Mandi builds that
    # only knew the single-photo field.
    photos:          List["ListingPhotoOut"] = Field(default_factory=list)
    village:         Optional[str]   = None
    # Aggregate rating for the FARMER who owns this listing. Buyers see
    # ⭐4.6 · 23 sales on the card — trust signal for a face they'll never meet.
    farmer_rating:       Optional[float] = None
    farmer_rating_count: int             = 0
    # Farmer-side additions. Populated only in list_my_listings so buyer
    # views (search, detail) can't leak inbox metadata from other farmers.
    pending_offers_count: int                    = 0
    latest_offer:         Optional[OfferSummary] = None
    # Auto-price-fit provenance (buyers see this to trust the ask price).
    market_source_apmc:        Optional[str]   = None
    market_source_district:    Optional[str]   = None
    market_source_price_kg:    Optional[float] = None
    market_source_distance_km: Optional[float] = None
    market_source_date:        Optional[str]   = None
    created_at:      datetime
    expires_at:      Optional[datetime] = None


class OfferIn(BaseModel):
    offered_price_per_kg: float = Field(..., gt=0)
    quantity_kg:          float = Field(..., gt=0)
    note:                 Optional[str] = None


class OfferOut(BaseModel):
    id:                   str
    listing_id:           str
    listing_crop:         Optional[str]
    listing_photo_url:    Optional[str] = None
    listing_village:      Optional[str] = None
    farmer_id:            Optional[str] = None
    farmer_name:          Optional[str] = None
    farmer_phone:         Optional[str] = None
    buyer_id:             str
    buyer_shop_name:      Optional[str]
    buyer_phone:          Optional[str] = None
    offered_price_per_kg: float
    quantity_kg:          float
    status:               str
    note:                 Optional[str]
    # Delivery OTP is returned to BOTH sides — farmer needs it to read out on
    # arrival, buyer needs it to enter into their app. Only present once the
    # offer has been accepted (status = IN_DELIVERY) and before it completes.
    delivery_otp:         Optional[str] = None
    completed_at:         Optional[datetime] = None
    cancelled_reason:     Optional[str] = None
    # Buyer-facing flag: has THIS buyer rated the farmer on THIS completed
    # offer already? Mandi Orders uses it to hide the "Rate farmer" prompt
    # once done. Always False for offers that are not yet COMPLETED.
    rated:                bool = False
    created_at:           datetime
    responded_at:         Optional[datetime]
    expires_at:           datetime


class RatingIn(BaseModel):
    stars:   int          = Field(..., ge=1, le=5)
    comment: Optional[str] = None


class OfferDecision(BaseModel):
    action: Literal["ACCEPT", "REJECT"]


class DeliveryComplete(BaseModel):
    """Buyer enters the OTP the farmer read aloud on delivery."""
    otp: str = Field(..., min_length=6, max_length=6)


class DeliveryCancel(BaseModel):
    """Farmer aborts an accepted delivery (truck broke down, etc)."""
    reason: str = Field(..., min_length=3, max_length=200)


class ManualComplete(BaseModel):
    """Farmer bypass when buyer forgot the OTP. Fires a notification to the buyer."""
    confirm: bool = True


class BenchmarkOut(BaseModel):
    crop_name:       str
    district:        str
    benchmark_price: float
    source:          str
    fetched_at:      datetime
    ttl_hours:       int
    stale:           bool


# ── AGMARKNET benchmark cache ───────────────────────────────────────────────

def _get_or_fetch_benchmark(
    crop_name: str, district: str, db: Session,
) -> Optional[models.PriceBenchmark]:
    """
    Look up a cached benchmark for (crop, district). Refresh from AGMARKNET
    if the cache is older than BENCHMARK_TTL_HRS or missing.

    Returns None only when we have NEITHER a cached value NOR a live fetch —
    callers must then handle the unverified case (listing allowed but flagged).
    """
    row = (
        db.query(models.PriceBenchmark)
        .filter_by(crop_name=crop_name, district=district)
        .order_by(desc(models.PriceBenchmark.fetched_at))
        .first()
    )
    age = None
    if row and row.fetched_at:
        age = datetime.utcnow() - row.fetched_at
    if row and age and age < timedelta(hours=BENCHMARK_TTL_HRS):
        return row

    # Try a live AGMARKNET refresh. Any failure → return the stale row (if any).
    fresh = _fetch_agmarknet_price(crop_name, district)
    if fresh is None:
        return row                                    # may be stale, may be None
    new_row = models.PriceBenchmark(
        id=str(uuid.uuid4()),
        crop_name=crop_name, district=district,
        benchmark_price=fresh, source="agmarknet",
    )
    db.add(new_row)
    db.commit()
    db.refresh(new_row)
    return new_row


def _fetch_agmarknet_price(crop_name: str, district: str) -> Optional[float]:
    """
    Call AGMARKNET for one crop+district. Returns average modal price across
    the returned rows, or None on any failure. Never raises — the cache
    fallback path in the caller handles the None case.

    Uses the existing _agmarknet_fetch helper in home_endpoints so we get
    the same browser User-Agent + retry logic.
    """
    try:
        from home_endpoints import _agmarknet_fetch, AGMARKNET_KEY
        if not AGMARKNET_KEY:
            return None
        params = {
            "api-key": AGMARKNET_KEY,
            "format":  "json",
            "limit":   50,
            "filters[state]":     "Karnataka",
            "filters[district]":  district,
            "filters[commodity]": crop_name,
        }
        data = _agmarknet_fetch(params)
        rows = data.get("records", []) or []
        prices = []
        for r in rows:
            # AGMARKNET returns modal_price as ₹/quintal; convert to ₹/kg.
            try:
                p = float(r.get("modal_price") or r.get("Modal_Price") or 0)
                if p > 0:
                    prices.append(p / 100.0)
            except (TypeError, ValueError):
                continue
        if not prices:
            return None
        return round(sum(prices) / len(prices), 2)
    except Exception:
        return None


# ── Helpers ─────────────────────────────────────────────────────────────────

def _fmt_qty(q) -> str:
    """
    Format a quantity_kg value for human display. SQLAlchemy Numeric
    columns come back as Decimal — bare f-string yields absurdities like
    "50.000000000000". Whole numbers render as int ("50"); fractional
    values keep 1 decimal ("47.3"). Used in every farmer/buyer-facing
    notification body so we never leak backend precision to the user.
    """
    if q is None: return "?"
    try:
        f = float(q)
    except (TypeError, ValueError):
        return str(q)
    return str(int(f)) if abs(f - round(f)) < 0.05 else f"{f:.1f}"


def _photo_url_for(row: models.CropListing) -> Optional[str]:
    """Turn stored relative path into a full URL the app can Image-load."""
    if not row.photo_path:
        return None
    # Relative — leaves the origin choice to the client (they know API_BASE).
    return f"/uploads/{row.photo_path}"


def _photos_for(listing_id: str, db: Session) -> List[ListingPhotoOut]:
    """All photos for a listing, sorted by sort_order asc. Empty when none."""
    rows = (
        db.query(models.ListingPhoto)
        .filter_by(listing_id=str(listing_id))
        .order_by(models.ListingPhoto.sort_order.asc(), models.ListingPhoto.created_at.asc())
        .all()
    )
    return [
        ListingPhotoOut(id=str(r.id), url=f"/uploads/{r.photo_path}")
        for r in rows if r.photo_path
    ]


def _rating_summary(farmer_id: str, db: Session) -> tuple[Optional[float], int]:
    """(avg_stars_rounded_1dp, count). Returns (None, 0) if the farmer has no ratings yet."""
    row = (
        db.query(func.avg(models.FarmerRating.stars), func.count(models.FarmerRating.id))
        .filter(models.FarmerRating.farmer_id == str(farmer_id))
        .one()
    )
    avg, cnt = row
    if not cnt:
        return (None, 0)
    return (round(float(avg), 1), int(cnt))


def _listing_to_out(
    row:                     models.CropListing,
    farmer:                  Optional[models.FarmerProfile] = None,
    distance:                Optional[float] = None,
    benchmark:               Optional[float] = None,
    fair:                    bool = False,
    include_offer_metadata:  bool = False,
    db:                      Optional[Session] = None,
) -> ListingOut:
    # Offer metadata is expensive-ish (extra query per row) so we only fetch it
    # for the farmer's OWN listings feed. Buyer-facing endpoints skip it.
    pending_count = 0
    latest_offer_out: Optional[OfferSummary] = None
    if include_offer_metadata and db is not None:
        offers = (
            db.query(models.TradeOffer)
            .filter_by(listing_id=row.id)
            .order_by(desc(models.TradeOffer.created_at))
            .all()
        )
        pending_count = sum(1 for o in offers if o.status == models.OfferStatus.PENDING)
        if offers:
            top = offers[0]
            buyer = db.get(models.BuyerProfile, top.buyer_id)
            latest_offer_out = OfferSummary(
                id                   = str(top.id),
                offered_price_per_kg = float(top.offered_price_per_kg),
                quantity_kg          = float(top.quantity_kg),
                buyer_shop_name      = buyer.shop_name if buyer else None,
                status               = top.status.value if hasattr(top.status, "value") else str(top.status),
                created_at           = top.created_at,
            )

    return ListingOut(
        id            = str(row.id),
        listing_id    = str(row.id),
        farmer_id     = str(row.farmer_id),
        farmer_name   = farmer.full_name    if farmer else None,
        farmer_phone  = farmer.phone_number if farmer else None,
        plot_id       = str(row.plot_id)  if row.plot_id  else None,
        cycle_id      = str(row.cycle_id) if row.cycle_id else None,
        crop_name     = row.crop_name,
        crop_name_kn  = row.crop_name_kn,
        quantity_kg   = float(row.quantity_kg),
        price_per_kg  = float(row.calculated_price_per_kg),
        status        = row.status.value if hasattr(row.status, "value") else str(row.status),
        latitude      = float(row.latitude)  if row.latitude  is not None else 0.0,
        longitude     = float(row.longitude) if row.longitude is not None else 0.0,
        distance_km   = distance,
        benchmark_price = benchmark if benchmark is not None else (
            float(row.benchmark_price_at_listing) if row.benchmark_price_at_listing is not None else None
        ),
        # Verified if the price is anchored to EITHER the AGMARKNET benchmark
        # cache OR the auto-fit APMC snapshot (KMV / data.gov.in). Older listings
        # that were manually typed with neither source stay "Unverified".
        price_verified = (
            row.benchmark_price_at_listing is not None
            or row.market_source_price_kg is not None
        ),
        fair_price    = fair,
        photo_url     = _photo_url_for(row),
        photos        = _photos_for(row.id, db) if db is not None else [],
        village       = row.village,
        farmer_rating       = (_rating_summary(row.farmer_id, db)[0] if db is not None else None),
        farmer_rating_count = (_rating_summary(row.farmer_id, db)[1] if db is not None else 0),
        pending_offers_count = pending_count,
        latest_offer         = latest_offer_out,
        market_source_apmc        = row.market_source_apmc,
        market_source_district    = row.market_source_district,
        market_source_price_kg    = float(row.market_source_price_kg)    if row.market_source_price_kg    is not None else None,
        market_source_distance_km = float(row.market_source_distance_km) if row.market_source_distance_km is not None else None,
        market_source_date        = row.market_source_date,
        # Legacy rows created before the auto-migration added created_at may
        # have NULL here — fall back to now so Pydantic doesn't reject the
        # response. Never affects new rows (create_listing sets it explicitly).
        created_at    = row.created_at or datetime.utcnow(),
        expires_at    = row.expires_at,
    )


def _offer_to_out(
    row:               models.TradeOffer,
    listing:           Optional[models.CropListing] = None,
    buyer:             Optional[models.BuyerProfile] = None,
    farmer:            Optional[models.FarmerProfile] = None,
    reveal_otp_to:     Optional[Literal["buyer", "farmer"]] = None,
    db:                Optional[Session] = None,
) -> OfferOut:
    """
    Only the buyer sees the OTP — they possess it, they share it with the
    farmer on physical delivery, farmer types it into their app to verify.
    This is why `reveal_otp_to="buyer"` is the only path that populates
    delivery_otp. Farmer endpoints pass `reveal_otp_to="farmer"` which
    intentionally leaves it None (farmer must ask the buyer, not read it
    from their own screen).

    OTP is only present during IN_DELIVERY — before ACCEPT it doesn't exist
    yet, after COMPLETION/CANCELLATION we hide it so old records don't leak.
    """
    show_otp = (
        row.status == models.OfferStatus.IN_DELIVERY
        and reveal_otp_to == "buyer"
    )
    # Cheap existence check — one row lookup by unique offer_id index.
    already_rated = False
    if db is not None and row.status == models.OfferStatus.COMPLETED:
        already_rated = (
            db.query(models.FarmerRating.id)
            .filter(models.FarmerRating.offer_id == str(row.id))
            .first()
            is not None
        )
    return OfferOut(
        id                   = str(row.id),
        listing_id           = str(row.listing_id),
        listing_crop         = listing.crop_name if listing else None,
        listing_photo_url    = _photo_url_for(listing) if listing else None,
        listing_village      = listing.village if listing else None,
        farmer_id            = str(listing.farmer_id) if listing else None,
        farmer_name          = farmer.full_name    if farmer else None,
        farmer_phone         = farmer.phone_number if farmer else None,
        buyer_id             = str(row.buyer_id),
        buyer_shop_name      = buyer.shop_name    if buyer else None,
        buyer_phone          = buyer.phone_number if buyer else None,
        offered_price_per_kg = float(row.offered_price_per_kg),
        quantity_kg          = float(row.quantity_kg),
        status               = row.status.value if hasattr(row.status, "value") else str(row.status),
        note                 = row.note,
        delivery_otp         = row.delivery_otp if show_otp else None,
        completed_at         = row.completed_at,
        cancelled_reason     = row.cancelled_reason,
        rated                = already_rated,
        created_at           = row.created_at,
        responded_at         = row.responded_at,
        expires_at           = row.expires_at,
    )


def _expire_stale_offers(db: Session) -> int:
    """Auto-expire pending offers older than OFFER_TTL_HOURS. Cheap opportunistic sweep."""
    now = datetime.utcnow()
    rows = (
        db.query(models.TradeOffer)
        .filter(models.TradeOffer.status == models.OfferStatus.PENDING)
        .filter(models.TradeOffer.expires_at < now)
        .all()
    )
    for r in rows:
        r.status = models.OfferStatus.EXPIRED
        r.responded_at = now
    if rows:
        db.commit()
    return len(rows)


def _district_for(lat: Optional[float], lng: Optional[float], farmer: Optional[models.FarmerProfile]) -> str:
    """Best-effort district: farmer.location_name → 'Kolar' fallback. AGMARKNET
    needs an exact district string, so if we don't have one we default to
    Kolar (project's home district)."""
    if farmer and farmer.location_name:
        return farmer.location_name.split(",")[0].strip()
    return "Kolar"


def _post_sale_to_ledger(
    listing:   models.CropListing,
    farmer_id: str,
    amount:    float,
    db:        Session,
) -> None:
    """
    When a listing sells, if it was tied to a plot, post an INCOME entry to
    the plot's newest active cycle matching the crop, then RECOMPUTE that
    cycle's cached totals so the Business tab reflects the new income
    immediately (not on next harvest).

    Match strategy — in priority order:
      1. Exact cycle_id link on the listing
      2. Plot's newest GROWING cycle whose crop matches (case-insensitive)
      3. Plot's newest cycle of ANY status matching the crop
         (covers PLANNED / HARVESTED so an income posting isn't silently lost)

    Silent no-op only if no plot linked or the plot has no matching cycle
    at all — the trade still records on the listing itself.
    """
    if not listing.plot_id:
        print(f"[sale] no plot_id on listing {listing.id} — ledger post skipped")
        return
    cycle: Optional[models.CropCycle] = None
    if listing.cycle_id:
        cycle = db.get(models.CropCycle, listing.cycle_id)

    if cycle is None:
        # Try GROWING first, fall back to any status. Case-insensitive match
        # because farmers occasionally re-type the crop with different casing.
        base_q = (
            db.query(models.CropCycle)
            .filter(models.CropCycle.plot_id == listing.plot_id)
            .filter(func.lower(models.CropCycle.crop_name) == (listing.crop_name or '').lower())
        )
        cycle = (
            base_q
            .filter(models.CropCycle.status == models.CycleStatus.GROWING)
            .order_by(desc(models.CropCycle.created_at))
            .first()
        )
        if cycle is None:
            cycle = base_q.order_by(desc(models.CropCycle.created_at)).first()

    if cycle is None:
        print(f"[sale] no matching cycle on plot {listing.plot_id} for '{listing.crop_name}' — ledger post skipped")
        return
    cycle_id = cycle.id
    print(f"[sale] posting ₹{amount} → cycle {cycle_id} ({cycle.crop_name})")

    entry = models.FarmLedger(
        id               = str(uuid.uuid4()),
        farmer_id        = farmer_id,
        transaction_type = models.TransactionType.INCOME,
        amount           = amount,
        category         = "SALE",
        timestamp        = datetime.utcnow(),
        cycle_id         = cycle_id,
        subcategory      = "SALE",
    )
    db.add(entry)
    db.flush()   # ensure the ledger row is visible before recomputing totals

    # Recompute the cycle's cached total_revenue / total_expenses / net_profit
    # / roi_percent immediately, so the Business tab reflects the sale without
    # waiting for the next manual harvest. Uses the pure-function summary from
    # bi_endpoints to keep the math in one place.
    try:
        from bi_endpoints import _refresh_cycle_totals
        _refresh_cycle_totals(cycle, db)
    except Exception as e:
        print(f"[sale] cycle-totals recompute skipped: {e}")


# ── Listing endpoints ───────────────────────────────────────────────────────

@router.post("/listings", response_model=ListingOut, status_code=status.HTTP_200_OK)
def create_listing(
    body: ListingIn,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    with open("debug_listing.log", "a", encoding="utf-8") as f:
        f.write(f"REQUEST: {body.model_dump_json()}\n")

    try:
        district = body.district or _district_for(body.latitude, body.longitude, farmer)

        # Use cached benchmark only — avoid a slow AGMARKNET network call on
        # the hot path. If the cache is empty the listing is marked unverified,
        # which is fine. A background refresh can populate the cache later.
        bench = (
            db.query(models.PriceBenchmark)
            .filter_by(crop_name=body.crop_name, district=district)
            .order_by(desc(models.PriceBenchmark.fetched_at))
            .first()
        )
        benchmark_price = float(bench.benchmark_price) if bench else None

        v = validate_price(body.price_per_kg, benchmark_price)
        if not v.ok:
            with open("debug_listing.log", "a", encoding="utf-8") as f:
                f.write(f"REJECTED: {v}\n")
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={
                "error":           "price_out_of_range",
                "reason":          v.reason,
                "floor":           v.floor,
                "ceiling":         v.ceiling,
                "benchmark_price": v.benchmark_price,
            })

        # Use a cached village name if we have it — don't block on Nominatim.
        geo_key = f"{round(body.latitude, 3)},{round(body.longitude, 3)}"
        village = _geocode_cache.get(geo_key) or None

        listing_id = str(uuid.uuid4())
        row = models.CropListing(
            id                       = listing_id,
            farmer_id                = str(farmer.id),
            plot_id                  = body.plot_id,
            cycle_id                 = body.cycle_id,
            crop_name                = body.crop_name,
            crop_name_kn             = body.crop_name_kn,
            quantity_kg              = body.quantity_kg,
            calculated_price_per_kg  = body.price_per_kg,
            status                   = models.CropStatus.AVAILABLE,
            location                 = f"{body.latitude},{body.longitude}",
            latitude                 = body.latitude,
            longitude                = body.longitude,
            benchmark_price_at_listing = benchmark_price,
            village                  = village,
            market_source_apmc        = body.market_source_apmc,
            market_source_district    = body.market_source_district,
            market_source_price_kg    = body.market_source_price_kg,
            market_source_distance_km = body.market_source_distance_km,
            market_source_date        = body.market_source_date,
            created_at               = datetime.utcnow(),
            expires_at               = datetime.utcnow() + timedelta(
                days=body.expires_in_days
                     if body.expires_in_days is not None
                     else _shelf_days(body.crop_name)
            ),
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        # Fire a background thread to fill in the village name if we didn't
        # have it cached. It updates the DB row silently — no user-visible
        # delay and no crash if Nominatim is slow.
        if not village:
            def _backfill_village(lid: str, lat: float, lng: float) -> None:
                try:
                    name = _reverse_geocode_village(lat, lng)
                    if name:
                        from database import SessionLocal as _SL
                        _db = _SL()
                        try:
                            _row = _db.get(models.CropListing, lid)
                            if _row and not _row.village:
                                _row.village = name
                                _db.commit()
                        finally:
                            _db.close()
                except Exception:
                    pass
            import threading
            threading.Thread(
                target=_backfill_village,
                args=(listing_id, body.latitude, body.longitude),
                daemon=True,
            ).start()

        from commerce.calculations import PRICE_WINDOW_PCT
        fair = False
        if benchmark_price is not None and benchmark_price > 0:
            fair = abs(body.price_per_kg - benchmark_price) <= benchmark_price * (PRICE_WINDOW_PCT / 2)
        elif body.market_source_price_kg is not None and body.market_source_price_kg > 0:
            fair = abs(body.price_per_kg - body.market_source_price_kg) <= body.market_source_price_kg * (PRICE_WINDOW_PCT / 2)

        out = _listing_to_out(row, farmer=farmer, benchmark=benchmark_price, fair=fair, db=db)
        out.status = "listed"
        if out.benchmark_price is None and out.market_source_price_kg is not None:
            out.benchmark_price = out.market_source_price_kg

        with open("debug_listing.log", "a", encoding="utf-8") as f:
            f.write(f"SUCCESS: {out.model_dump_json()}\n")
        return out
    except HTTPException as he:
        with open("debug_listing.log", "a", encoding="utf-8") as f:
            f.write(f"HTTP_EXCEPTION: {he.detail}\n")
        raise
    except Exception as e:
        import traceback
        with open("debug_listing.log", "a", encoding="utf-8") as f:
            f.write(f"EXCEPTION: {traceback.format_exc()}\n")
        raise


@router.get("/listings/search", response_model=List[ListingOut])
def search_listings(
    lat:       float = Query(..., ge=-90,  le=90),
    lng:       float = Query(..., ge=-180, le=180),
    radius_km: float = Query(DEFAULT_RADIUS_KM, gt=0, le=100),
    crop:      Optional[str] = Query(None, description="Substring crop-name filter"),
    limit:     int = Query(50, ge=1, le=200),
    db: Session = Depends(database.get_db),
):
    """
    Buyer's proximity search. Returns listings within radius_km, ranked by
    the (0.6 * distance + 0.4 * price-fairness) formula. Cheaper listings
    that are far away are ranked BELOW nearby listings at benchmark.
    """
    q = (
        db.query(models.CropListing, models.FarmerProfile)
        .join(models.FarmerProfile, models.CropListing.farmer_id == models.FarmerProfile.id)
        .filter(models.CropListing.status == models.CropStatus.AVAILABLE)
        .filter(models.CropListing.quantity_kg > 0)
    )
    if crop:
        q = q.filter(models.CropListing.crop_name.ilike(f"%{crop}%"))
    rows = q.all()

    # Snapshot for the ranker
    snapshots: list[ListingSnapshot] = []
    row_by_id: dict[str, tuple[models.CropListing, models.FarmerProfile]] = {}
    for lst, farm in rows:
        if lst.latitude is None or lst.longitude is None:
            # Backfill from legacy "lat,lon" text on-the-fly. Skip if it's mangled.
            try:
                lat_s, lon_s = str(lst.location).split(",")
                lat_v, lon_v = float(lat_s), float(lon_s)
            except (ValueError, AttributeError):
                continue
        else:
            lat_v = float(lst.latitude); lon_v = float(lst.longitude)
        snapshots.append(ListingSnapshot(
            id=str(lst.id), crop_name=lst.crop_name,
            price_per_kg=float(lst.calculated_price_per_kg),
            quantity_kg=float(lst.quantity_kg),
            latitude=lat_v, longitude=lon_v,
        ))
        row_by_id[str(lst.id)] = (lst, farm)

    # Benchmark map — we reuse whatever was stored on each listing rather than
    # re-hitting AGMARKNET per row (that would fan out to hundreds of API
    # calls). If a listing has no stored benchmark, the ranker gets None
    # and scores that listing mid-pack.
    benchmarks: dict[str, Optional[float]] = {}
    for lst, _ in rows:
        b = lst.benchmark_price_at_listing
        benchmarks[lst.crop_name] = float(b) if b is not None else benchmarks.get(lst.crop_name)

    ranked = rank_listings(snapshots, lat, lng, radius_km, benchmarks)[:limit]
    out = []
    for r in ranked:
        lst, farm = row_by_id[r.listing.id]
        out.append(_listing_to_out(
            lst, farmer=farm,
            distance=r.distance_km,
            benchmark=r.benchmark_price,
            fair=r.fair_price,
            db=db,
        ))
    return out


@router.get("/listings/{listing_id}", response_model=ListingOut)
def get_listing(
    listing_id: str,
    lat: Optional[float] = Query(None), lng: Optional[float] = Query(None),
    db: Session = Depends(database.get_db),
):
    lst = db.get(models.CropListing, listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    farmer = db.get(models.FarmerProfile, lst.farmer_id)
    dist = None
    if lat is not None and lng is not None and lst.latitude and lst.longitude:
        dist = round(haversine_km(lat, lng, float(lst.latitude), float(lst.longitude)), 2)
    return _listing_to_out(lst, farmer=farmer, distance=dist, db=db)


@router.patch("/listings/{listing_id}", response_model=ListingOut)
def update_listing(
    listing_id: str,
    body: ListingUpdate,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    lst = db.get(models.CropListing, listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")

    if body.price_per_kg is not None:
        # Re-validate: no back door for edited prices.
        district = body.district or _district_for(None, None, farmer)
        bench = _get_or_fetch_benchmark(lst.crop_name, district, db)
        benchmark_price = float(bench.benchmark_price) if bench else None
        v = validate_price(body.price_per_kg, benchmark_price)
        if not v.ok:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={
                "error": "price_out_of_range", "reason": v.reason,
                "floor": v.floor, "ceiling": v.ceiling,
                "benchmark_price": v.benchmark_price,
            })
        lst.calculated_price_per_kg = body.price_per_kg
        lst.benchmark_price_at_listing = benchmark_price

    if body.quantity_kg is not None:
        lst.quantity_kg = body.quantity_kg
        # A quantity that hits zero exactly should auto-flip status to SOLD
        # so it drops out of the search results — no zombie "0 kg available".
        if body.quantity_kg <= 0 and lst.status == models.CropStatus.AVAILABLE:
            lst.status = models.CropStatus.SOLD

    if body.status is not None:
        new_status = models.CropStatus(body.status)
        was_sold = lst.status != models.CropStatus.SOLD and new_status == models.CropStatus.SOLD
        lst.status = new_status
        if was_sold:
            # Book the income against the linked cycle (Business tab).
            amount = float(lst.calculated_price_per_kg) * float(lst.quantity_kg or 0)
            if amount > 0:
                _post_sale_to_ledger(lst, str(farmer.id), amount, db)

    db.commit()
    db.refresh(lst)
    return _listing_to_out(lst, farmer=farmer, db=db)


@router.delete("/listings/{listing_id}")
def delete_listing(
    listing_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Hard-delete a listing. Farmer can only delete their own listings.

    Also removes any offers attached to it — otherwise buyers would see
    "PENDING" offers pointing at a listing that no longer exists.
    """
    lst = db.get(models.CropListing, listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")

    # Cascade offers so nothing dangles
    db.query(models.TradeOffer).filter_by(listing_id=lst.id).delete(synchronize_session=False)
    db.delete(lst)
    db.commit()
    return {"status": "deleted", "listing_id": listing_id}


@router.get("/listings", response_model=List[ListingOut])
def list_my_listings(
    include_expired: bool = Query(
        False,
        description="If true, also return TERMINAL listings — both EXPIRED "
                    "(shelf-life auto-swept) and SOLD (full delivery "
                    "completed). Default false so the farmer's Active / "
                    "Orders / Delivery tabs stay clean of dead rows. "
                    "The Upaj 'Past listings' section passes true.",
    ),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Farmer's own listings — powers the Sell dashboard.
    Includes pending_offers_count + latest_offer so the frontend can:
      * Split into Active / Orders / Delivery tabs client-side
      * Surface an alert badge on the dashboard header without a 2nd call

    By default, TERMINAL listings (EXPIRED via shelf-life sweep, or SOLD
    via full delivery) are excluded — they'd only pollute the working
    tabs. The Upaj "Past listings" section requests `?include_expired=true`
    to render the farmer's trade history.
    """
    q = (
        db.query(models.CropListing)
        .filter_by(farmer_id=str(farmer.id))
    )
    if not include_expired:
        # Exclude BOTH terminal statuses so completed / expired listings
        # don't reappear in Active just because they had a stale PENDING
        # offer row.
        q = q.filter(
            models.CropListing.status != models.CropStatus.EXPIRED,
            models.CropListing.status != models.CropStatus.SOLD,
        )
    rows = q.order_by(desc(models.CropListing.created_at)).all()
    return [
        _listing_to_out(r, farmer=farmer, include_offer_metadata=True, db=db)
        for r in rows
    ]


# ── Photo upload ────────────────────────────────────────────────────────────

@router.post("/listings/{listing_id}/photo", response_model=ListingOut)
async def upload_listing_photo(
    listing_id: str,
    file: UploadFile = File(...),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Attach / replace a photo on the farmer's own listing.

    Storage: local filesystem under backend/uploads/listings/<listing_id>.jpg.
    Served publicly via /uploads/... (StaticFiles mount in main.py) so both
    Upaj and Mandi apps load the same image.

    The image is intended to be pre-compressed on the client
    (expo-image-manipulator → max 1200 px, 70% JPEG). Backend enforces a
    5 MB ceiling as a defensive check.
    """
    lst = db.get(models.CropListing, listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")

    # Read + size-check. UploadFile.read() streams into memory — fine at 5 MB.
    contents = await file.read()
    if not contents:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Photo too large ({len(contents)/1_000_000:.1f} MB). Max 5 MB.",
        )

    # Extension picked from mime, default to .jpg. Filename = listing_id so
    # replacing the photo naturally overwrites the previous file.
    ext = ".jpg"
    if file.content_type == "image/png":  ext = ".png"
    elif file.content_type == "image/webp": ext = ".webp"

    filename  = f"{listing_id}{ext}"
    dest_path = UPLOAD_DIR / filename
    dest_path.write_bytes(contents)

    lst.photo_path = f"listings/{filename}"
    # Mirror into listing_photos as sort_order=0 (primary). Replace any
    # existing sort_order=0 row so a re-upload doesn't leave orphans.
    existing_primary = (
        db.query(models.ListingPhoto)
        .filter_by(listing_id=str(listing_id), sort_order=0)
        .first()
    )
    if existing_primary:
        existing_primary.photo_path = f"listings/{filename}"
    else:
        db.add(models.ListingPhoto(
            listing_id=str(listing_id),
            photo_path=f"listings/{filename}",
            sort_order=0,
        ))
    db.commit()
    db.refresh(lst)
    return _listing_to_out(lst, farmer=farmer, include_offer_metadata=True, db=db)


# ── Multi-photo (append / delete) ───────────────────────────────────────────
# The legacy /listings/{id}/photo endpoint above sets the PRIMARY photo
# (sort_order=0) and keeps CropListing.photo_path in sync for backward
# compat. These new endpoints manage the additional photos (sort_order 1..4).

MAX_PHOTOS_PER_LISTING = 5


@router.post("/listings/{listing_id}/photos", response_model=ListingOut)
async def append_listing_photo(
    listing_id: str,
    file: UploadFile = File(...),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """Append one more photo. Rejects if the listing already has MAX."""
    lst = db.get(models.CropListing, listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")

    count = db.query(models.ListingPhoto).filter_by(listing_id=str(listing_id)).count()
    if count >= MAX_PHOTOS_PER_LISTING:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Maximum {MAX_PHOTOS_PER_LISTING} photos per listing",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Photo too large ({len(contents)/1_000_000:.1f} MB). Max 5 MB.",
        )

    ext = ".jpg"
    if file.content_type == "image/png":  ext = ".png"
    elif file.content_type == "image/webp": ext = ".webp"

    # Unique filename per photo so different photos on the same listing
    # don't overwrite each other.
    photo_id = str(uuid.uuid4())
    filename  = f"{listing_id}_{photo_id}{ext}"
    dest_path = UPLOAD_DIR / filename
    dest_path.write_bytes(contents)

    db.add(models.ListingPhoto(
        id=photo_id,
        listing_id=str(listing_id),
        photo_path=f"listings/{filename}",
        sort_order=count,
    ))
    db.commit()
    db.refresh(lst)
    return _listing_to_out(lst, farmer=farmer, include_offer_metadata=True, db=db)


@router.delete("/listings/{listing_id}/photos/{photo_id}", response_model=ListingOut)
def delete_listing_photo(
    listing_id: str,
    photo_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """Remove one photo. If it was the primary, the next remaining photo is
    promoted and mirrored to CropListing.photo_path so legacy single-photo
    clients still see something."""
    lst = db.get(models.CropListing, listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")

    photo = db.get(models.ListingPhoto, photo_id)
    if not photo or str(photo.listing_id) != str(listing_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")

    try:
        (UPLOAD_DIR / Path(photo.photo_path).name).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(photo)
    db.flush()

    # Resequence remaining photos so sort_order stays dense 0..N.
    remaining = (
        db.query(models.ListingPhoto)
        .filter_by(listing_id=str(listing_id))
        .order_by(models.ListingPhoto.sort_order.asc(), models.ListingPhoto.created_at.asc())
        .all()
    )
    for i, r in enumerate(remaining):
        r.sort_order = i

    lst.photo_path = remaining[0].photo_path if remaining else None
    db.commit()
    db.refresh(lst)
    return _listing_to_out(lst, farmer=farmer, include_offer_metadata=True, db=db)


# ── Farmer rating ───────────────────────────────────────────────────────────

@router.post("/offers/{offer_id}/rate", response_model=OfferOut)
def rate_farmer(
    offer_id: str,
    body: RatingIn,
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """Buyer rates the farmer AFTER delivery completes. One rating per offer."""
    offer = db.get(models.TradeOffer, offer_id)
    if not offer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    if str(offer.buyer_id) != str(buyer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your offer")
    if offer.status != models.OfferStatus.COMPLETED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Can only rate after delivery is completed",
        )
    existing = (
        db.query(models.FarmerRating)
        .filter_by(offer_id=str(offer_id))
        .first()
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already rated this delivery")

    lst = db.get(models.CropListing, offer.listing_id)
    if not lst:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    db.add(models.FarmerRating(
        farmer_id = str(lst.farmer_id),
        buyer_id  = str(buyer.id),
        offer_id  = str(offer_id),
        stars     = body.stars,
        comment   = (body.comment or "").strip() or None,
    ))
    db.commit()
    db.refresh(offer)
    farmer = db.get(models.FarmerProfile, lst.farmer_id)
    return _offer_to_out(offer, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="buyer", db=db)


# ── Offer endpoints ─────────────────────────────────────────────────────────

@router.post("/listings/{listing_id}/offers", response_model=OfferOut, status_code=status.HTTP_201_CREATED)
def create_offer(
    listing_id: str,
    body: OfferIn,
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    # Rate-limit at 20 offers / 5 minutes per buyer — stops offer-flooding
    # attacks (a bad actor spamming a farmer's listing to hide legitimate
    # offers, or overwhelming the DB with junk rows). A real buyer bids
    # a handful of times per day.
    check_rate(bucket="offer_create", key=str(buyer.id),
               cap=20, window_s=300, friendly="offers")

    lst = db.get(models.CropListing, listing_id)
    if not lst or lst.status != models.CropStatus.AVAILABLE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not available")
    if body.quantity_kg > float(lst.quantity_kg):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Offer quantity exceeds available")

    # Same hard price-window rule as listings: buyer can't submit an offer
    # outside ±5% of the AGMARKNET benchmark either.
    benchmark = float(lst.benchmark_price_at_listing) if lst.benchmark_price_at_listing else None
    v = validate_price(body.offered_price_per_kg, benchmark)
    if not v.ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={
            "error": "offer_out_of_range", "reason": v.reason,
            "floor": v.floor, "ceiling": v.ceiling,
            "benchmark_price": v.benchmark_price,
        })

    row = models.TradeOffer(
        id                    = str(uuid.uuid4()),
        listing_id            = lst.id,
        buyer_id              = str(buyer.id),
        offered_price_per_kg  = body.offered_price_per_kg,
        quantity_kg           = body.quantity_kg,
        status                = models.OfferStatus.PENDING,
        note                  = body.note,
        expires_at            = datetime.utcnow() + timedelta(hours=OFFER_TTL_HOURS),
    )
    db.add(row)
    db.flush()
    # Notify the farmer that a new buyer has offered
    notify(
        db,
        recipient_id = str(lst.farmer_id),
        role         = "farmer",
        kind         = "OFFER_RECEIVED",
        title        = f"New offer on your {lst.crop_name} · ಹೊಸ ಬಿಡ್",
        body         = (
            f"{buyer.shop_name or 'A buyer'} offered "
            f"₹{body.offered_price_per_kg:.2f}/kg for {_fmt_qty(body.quantity_kg)} kg. "
            f"ಪ್ರತಿ ಕೆ.ಜಿ.ಗೆ ₹{body.offered_price_per_kg:.2f} "
            f"ದರದಲ್ಲಿ {_fmt_qty(body.quantity_kg)} ಕೆ.ಜಿ. ಬೇಡಿಕೆ ಬಂದಿದೆ."
        ),
        deep_link    = f"/market?listingId={lst.id}",
    )
    db.commit()
    db.refresh(row)
    farmer = db.get(models.FarmerProfile, lst.farmer_id)
    return _offer_to_out(row, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="buyer", db=db)


@router.patch("/offers/{offer_id}", response_model=OfferOut)
def respond_to_offer(
    offer_id: str,
    body: OfferDecision,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    offer = db.get(models.TradeOffer, offer_id)
    if not offer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    lst = db.get(models.CropListing, offer.listing_id)
    if not lst or str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")
    if offer.status != models.OfferStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Offer already responded to")

    now = datetime.utcnow()
    if body.action == "REJECT":
        offer.status = models.OfferStatus.REJECTED
        offer.responded_at = now
        notify(
            db, recipient_id=str(offer.buyer_id), role="buyer",
            kind="OFFER_REJECTED",
            title=f"Offer on {lst.crop_name} was rejected · ತಿರಸ್ಕರಿಸಲಾಗಿದೆ",
            body=(
                "Try browsing other nearby listings on Discover. "
                "ಡಿಸ್ಕವರ್‌ನಲ್ಲಿ ಬೇರೆ ಹತ್ತಿರದ ಬೆಳೆಗಳನ್ನು ನೋಡಿ."
            ),
            deep_link=f"/(tabs)/requests",
        )
    else:
        # ACCEPT → IN_DELIVERY. Generate OTP, lock listing, don't touch qty.
        # OTP is generated once here and never rotates — the buyer holds it,
        # farmer verifies it on physical delivery.
        offer.status         = models.OfferStatus.IN_DELIVERY
        offer.responded_at   = now
        offer.delivery_otp   = _generate_delivery_otp()
        lst.status = models.CropStatus.LOCKED
        # Fetch buyer up-front so notifications can reference their shop name.
        buyer_row = db.get(models.BuyerProfile, offer.buyer_id)
        buyer_label = (buyer_row.shop_name if buyer_row else None) or "the buyer"
        notify(
            db, recipient_id=str(offer.buyer_id), role="buyer",
            kind="OFFER_ACCEPTED",
            title=f"{lst.crop_name} is on the way · ನಿಮ್ಮ OTP ನಿಮ್ಮ ಬಳಿ ಇದೆ",
            body=(
                f"Farmer accepted your offer for {_fmt_qty(offer.quantity_kg)} kg. "
                f"Open the Delivery tab to see your 6-digit OTP. "
                f"ರೈತರು {_fmt_qty(offer.quantity_kg)} ಕೆ.ಜಿ. ಬಿಡ್ ಒಪ್ಪಿಕೊಂಡಿದ್ದಾರೆ. "
                f"Delivery ಟ್ಯಾಬ್‌ನಲ್ಲಿ OTP ನೋಡಿ; ಬೆಳೆ ಕೈ ಸೇರಿದಾಗ ಮಾತ್ರ ಹಂಚಿ."
            ),
            deep_link=f"/(tabs)/orders",
        )
        # Farmer notification — they must go deliver + ask for OTP on arrival
        notify(
            db, recipient_id=str(lst.farmer_id), role="farmer",
            kind="OFFER_ACCEPTED",
            title=f"Delivery started for {lst.crop_name} · ವಿತರಣೆ ಆರಂಭ",
            body=(
                f"You accepted {_fmt_qty(offer.quantity_kg)} kg for {buyer_label}. "
                f"Deliver the crop, then ask the buyer for their OTP. "
                f"{_fmt_qty(offer.quantity_kg)} ಕೆ.ಜಿ. ಒಪ್ಪಿದ್ದೀರಿ. ಬೆಳೆ ತಲುಪಿಸಿ, "
                f"ನಂತರ ಖರೀದಿದಾರರಿಂದ OTP ಪಡೆದು Delivery ಟ್ಯಾಬ್‌ನಲ್ಲಿ ನಮೂದಿಸಿ."
            ),
            deep_link=f"/(tabs)/market",
        )

        # Sweep sibling PENDING offers on this listing — the listing is now
        # LOCKED so they can never be accepted. Auto-reject them and tell
        # each losing buyer why, so they don't sit staring at a bid that
        # cannot resolve.
        siblings = db.query(models.TradeOffer).filter(
            models.TradeOffer.listing_id == lst.id,
            models.TradeOffer.id != offer.id,
            models.TradeOffer.status == models.OfferStatus.PENDING,
        ).all()
        for sib in siblings:
            sib.status = models.OfferStatus.REJECTED
            sib.responded_at = now
            sib.cancelled_reason = "Farmer accepted another bid on this listing"
            notify(
                db, recipient_id=str(sib.buyer_id), role="buyer",
                kind="OFFER_REJECTED",
                title=f"{lst.crop_name} went to another buyer · ಇನ್ನೊಬ್ಬರಿಗೆ ಹೋಯಿತು",
                body=(
                    "The farmer accepted another bid on this listing. "
                    "Browse Discover for other nearby crops. "
                    "ಈ ಬೆಳೆಗೆ ರೈತರು ಬೇರೆ ಬಿಡ್ ಒಪ್ಪಿಕೊಂಡಿದ್ದಾರೆ."
                ),
                deep_link="/(tabs)/requests",
            )

    db.commit()
    db.refresh(offer)
    buyer  = db.get(models.BuyerProfile, offer.buyer_id)
    # Farmer just accepted — they must NOT see the OTP. Buyer app will fetch
    # it from /offers/mine and /offers/delivery. Farmer types it in on
    # physical handover via /offers/{id}/verify-otp.
    return _offer_to_out(offer, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="farmer", db=db)


def _generate_delivery_otp() -> str:
    """6-digit numeric OTP. Not cryptographic — collision-tolerable because
    it's scoped to a single farmer+buyer trade and expires on completion."""
    import secrets
    return f"{secrets.randbelow(1_000_000):06d}"


@router.post("/offers/{offer_id}/verify-otp", response_model=OfferOut)
def verify_delivery_otp(
    offer_id: str,
    body: DeliveryComplete,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Farmer types in the OTP the BUYER shows them on physical delivery. This
    is the trust-safe closing step:

      * Buyer's app displays the OTP (they possess it)
      * Buyer reads it aloud only when the crop is in their hands
      * Farmer types it here → backend verifies → ledger posts

    The buyer holds the secret; the farmer must prove delivery by knowing it.
    """
    offer = db.get(models.TradeOffer, offer_id)
    if not offer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    lst = db.get(models.CropListing, offer.listing_id)
    if not lst or str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")
    if offer.status != models.OfferStatus.IN_DELIVERY:
        raise HTTPException(status.HTTP_409_CONFLICT, "Offer is not in delivery")
    if not offer.delivery_otp or body.otp.strip() != offer.delivery_otp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Wrong OTP")

    # NOW the trade is real: reduce quantity, flip SOLD if depleted, post income.
    new_qty = float(lst.quantity_kg) - float(offer.quantity_kg)
    lst.quantity_kg = max(0.0, new_qty)
    if lst.quantity_kg <= 0:
        lst.status = models.CropStatus.SOLD
    else:
        lst.status = models.CropStatus.AVAILABLE   # partial delivery — reopen for others

    offer.status       = models.OfferStatus.COMPLETED
    offer.completed_at = datetime.utcnow()

    amount = float(offer.offered_price_per_kg) * float(offer.quantity_kg)
    if amount > 0:
        _post_sale_to_ledger(lst, str(lst.farmer_id), amount, db)

    # Both sides get notified. Buyer's message emphasises "recorded" — no
    # further action from them, unlike before when the buyer initiated.
    notify(
        db, recipient_id=str(lst.farmer_id), role="farmer",
        kind="DELIVERY_COMPLETED",
        title=f"Sale complete — ₹{amount:,.0f} · ಮಾರಾಟ ಪೂರ್ಣ",
        body=(
            f"OTP verified. Sale of {_fmt_qty(offer.quantity_kg)} kg "
            f"{lst.crop_name} posted to your plot ledger. "
            f"OTP ದೃಢಪಟ್ಟಿದೆ. {_fmt_qty(offer.quantity_kg)} ಕೆ.ಜಿ. ಮಾರಾಟ "
            f"ನಿಮ್ಮ ಪ್ಲಾಟ್ ಲೆಜರ್‌ಗೆ ಸೇರಿಸಲಾಗಿದೆ."
        ),
        deep_link=f"/(tabs)/ledger",
    )
    notify(
        db, recipient_id=str(offer.buyer_id), role="buyer",
        kind="DELIVERY_COMPLETED",
        title=f"{lst.crop_name} delivery complete · ವಿತರಣೆ ಪೂರ್ಣ",
        body=(
            f"Farmer confirmed delivery of {_fmt_qty(offer.quantity_kg)} kg. "
            f"Total ₹{amount:,.0f}. "
            f"ರೈತರು {_fmt_qty(offer.quantity_kg)} ಕೆ.ಜಿ. ವಿತರಣೆ ದೃಢೀಕರಿಸಿದ್ದಾರೆ. "
            f"ಒಟ್ಟು ₹{amount:,.0f}."
        ),
        deep_link=f"/(tabs)/orders",
    )

    db.commit()
    db.refresh(offer)
    buyer = db.get(models.BuyerProfile, offer.buyer_id)
    return _offer_to_out(offer, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="farmer", db=db)


# Legacy alias — kept so older Mandi builds don't 404 while apps roll over.
# Buyer used to enter OTP; now they only display it. This shim returns 410
# with a message telling the client to update to the new farmer flow.
@router.post("/offers/{offer_id}/complete")
def complete_delivery_deprecated(offer_id: str):
    raise HTTPException(
        status.HTTP_410_GONE,
        "Delivery flow changed — the farmer now verifies the OTP. Update your app.",
    )


@router.post("/offers/{offer_id}/complete-manual", response_model=OfferOut)
def complete_delivery_manual(
    offer_id: str,
    body: ManualComplete,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Emergency-only farmer bypass: buyer forgot / lost the OTP. Same effect
    as /complete but originates from the farmer. Buyer app will surface a
    notification saying "farmer marked as delivered" so buyer can flag if
    the sale never actually happened.
    """
    offer = db.get(models.TradeOffer, offer_id)
    if not offer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    lst = db.get(models.CropListing, offer.listing_id)
    if not lst or str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")
    if offer.status != models.OfferStatus.IN_DELIVERY:
        raise HTTPException(status.HTTP_409_CONFLICT, "Not in delivery")

    new_qty = float(lst.quantity_kg) - float(offer.quantity_kg)
    lst.quantity_kg = max(0.0, new_qty)
    lst.status = models.CropStatus.SOLD if lst.quantity_kg <= 0 else models.CropStatus.AVAILABLE

    offer.status       = models.OfferStatus.COMPLETED
    offer.completed_at = datetime.utcnow()
    amount = float(offer.offered_price_per_kg) * float(offer.quantity_kg)
    if amount > 0:
        _post_sale_to_ledger(lst, str(farmer.id), amount, db)

    # Farmer used the manual override — buyer needs to know so they can flag
    # if the crop never actually arrived.
    notify(
        db, recipient_id=str(offer.buyer_id), role="buyer",
        kind="DELIVERY_MANUAL",
        title=f"Farmer marked {lst.crop_name} as delivered · OTP ಬಿಟ್ಟುಬಿಡಲಾಗಿದೆ",
        body=(
            "Delivery was confirmed manually (OTP skipped). "
            "If you didn't receive the crop, contact the farmer directly. "
            "OTP ಇಲ್ಲದೆ ವಿತರಣೆ ಗುರುತಿಸಲಾಗಿದೆ. "
            "ಬೆಳೆ ಸಿಗದಿದ್ದರೆ ರೈತರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ."
        ),
        deep_link=f"/(tabs)/orders",
    )

    db.commit()
    db.refresh(offer)
    buyer = db.get(models.BuyerProfile, offer.buyer_id)
    return _offer_to_out(offer, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="farmer", db=db)


@router.post("/offers/{offer_id}/cancel-delivery", response_model=OfferOut)
def cancel_delivery(
    offer_id: str,
    body: DeliveryCancel,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Farmer aborts a delivery in progress (truck broke down, quality dispute
    before handover, etc). Listing quantity is untouched (was never
    decremented on ACCEPT); status returns to AVAILABLE so the crop can be
    listed again. Offer is CANCELLED and the reason is stored so the buyer
    sees what happened.
    """
    offer = db.get(models.TradeOffer, offer_id)
    if not offer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    lst = db.get(models.CropListing, offer.listing_id)
    if not lst or str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")
    if offer.status != models.OfferStatus.IN_DELIVERY:
        raise HTTPException(status.HTTP_409_CONFLICT, "Not in delivery")

    offer.status           = models.OfferStatus.CANCELLED
    offer.cancelled_reason = body.reason.strip()
    offer.completed_at     = datetime.utcnow()
    # Restore listing so the crop can be sold again.
    lst.status = models.CropStatus.AVAILABLE

    notify(
        db, recipient_id=str(offer.buyer_id), role="buyer",
        kind="DELIVERY_CANCELLED",
        title=f"Farmer cancelled the {lst.crop_name} delivery · ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ",
        body=(
            f"Reason: {body.reason.strip()} · "
            f"ಕಾರಣ: {body.reason.strip()}"
        ),
        deep_link=f"/(tabs)/orders",
    )

    db.commit()
    db.refresh(offer)
    buyer = db.get(models.BuyerProfile, offer.buyer_id)
    return _offer_to_out(offer, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="farmer", db=db)


# ── Auto-complete stale deliveries (7-day escape valve) ─────────────────────

def _auto_complete_stale_deliveries(db: Session) -> int:
    """
    Prevents perpetual limbo: any IN_DELIVERY offer older than 7 days is
    auto-completed (income posts, listing quantity decrements). Called
    opportunistically from list endpoints — no cron needed.
    """
    cutoff = datetime.utcnow() - timedelta(days=7)
    stale = (
        db.query(models.TradeOffer)
        .filter(models.TradeOffer.status == models.OfferStatus.IN_DELIVERY)
        .filter(models.TradeOffer.responded_at != None)
        .filter(models.TradeOffer.responded_at < cutoff)
        .all()
    )
    for o in stale:
        lst = db.get(models.CropListing, o.listing_id)
        if not lst: continue
        new_qty = float(lst.quantity_kg) - float(o.quantity_kg)
        lst.quantity_kg = max(0.0, new_qty)
        lst.status = models.CropStatus.SOLD if lst.quantity_kg <= 0 else models.CropStatus.AVAILABLE
        o.status = models.OfferStatus.COMPLETED
        o.completed_at = datetime.utcnow()
        amount = float(o.offered_price_per_kg) * float(o.quantity_kg)
        if amount > 0:
            _post_sale_to_ledger(lst, str(lst.farmer_id), amount, db)
    if stale:
        db.commit()
    return len(stale)


@router.get("/listings/{listing_id}/offers", response_model=List[OfferOut])
def list_offers_for_listing(
    listing_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    lst = db.get(models.CropListing, listing_id)
    if not lst or str(lst.farmer_id) != str(farmer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your listing")
    _expire_stale_offers(db)
    _auto_complete_stale_deliveries(db)
    offers = (
        db.query(models.TradeOffer)
        .filter_by(listing_id=listing_id)
        .order_by(desc(models.TradeOffer.created_at))
        .all()
    )
    out = []
    for o in offers:
        buyer = db.get(models.BuyerProfile, o.buyer_id)
        # Farmer-scoped endpoint → hide OTP; farmer must ask the buyer.
        out.append(_offer_to_out(o, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="farmer", db=db))
    return out


@router.get("/offers/mine", response_model=List[OfferOut])
def list_my_offers(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """
    Buyer's OFFER-BOOK — only the ones still living on the "Requests" tab
    (PENDING) or in a closed non-delivery terminal state
    (REJECTED / EXPIRED / WITHDRAWN / CANCELLED). Completed sales live
    under `/offers/orders` (Past Orders) and in-delivery ones under
    `/offers/delivery` — surfacing them here too would double-show the
    same trade in two places and confuse the buyer ("old data still
    visible even after delivery"). Legacy ACCEPTED rows (pre-OTP flow)
    are also excluded from Requests for the same reason.
    """
    _expire_stale_offers(db)
    _auto_complete_stale_deliveries(db)
    offers = (
        db.query(models.TradeOffer)
        .filter(models.TradeOffer.buyer_id == str(buyer.id))
        .filter((models.TradeOffer.hidden_from_buyer.is_(None))
                | (models.TradeOffer.hidden_from_buyer == False))
        .filter(models.TradeOffer.status.notin_([
            models.OfferStatus.COMPLETED,
            models.OfferStatus.IN_DELIVERY,
            models.OfferStatus.ACCEPTED,     # legacy pre-OTP flow — treated as done elsewhere
        ]))
        .order_by(desc(models.TradeOffer.created_at))
        .all()
    )
    out = []
    for o in offers:
        lst    = db.get(models.CropListing, o.listing_id)
        farmer = db.get(models.FarmerProfile, lst.farmer_id) if lst else None
        out.append(_offer_to_out(o, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="buyer", db=db))
    return out


@router.delete("/offers/{offer_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
def hide_offer_from_buyer(
    offer_id: str,
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """
    Buyer taps the ✕ on a closed request or a past order to clear it from
    their own view. Row is preserved on the farmer's side (their history +
    any BI stays intact); only the buyer's list endpoints filter it out.
    Only allowed on non-active offers — you can't hide something you still
    need to see (PENDING, ACCEPTED, IN_DELIVERY).
    """
    offer = db.get(models.TradeOffer, offer_id)
    if offer is None or str(offer.buyer_id) != str(buyer.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="offer_not_found")
    if offer.status in (models.OfferStatus.PENDING,
                        models.OfferStatus.ACCEPTED,
                        models.OfferStatus.IN_DELIVERY):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={
            "error":   "offer_still_active",
            "message": "Withdraw the offer first, or wait for it to close.",
        })
    offer.hidden_from_buyer = True
    db.commit()
    return None


@router.get("/offers/delivery", response_model=List[OfferOut])
def list_my_in_delivery(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """
    Buyer's IN_DELIVERY offers. The OTP is populated here (reveal_otp_to
    ='buyer') — buyer shows it on delivery, farmer types it into their app
    to verify.
    """
    _auto_complete_stale_deliveries(db)
    offers = (
        db.query(models.TradeOffer)
        .filter_by(buyer_id=str(buyer.id), status=models.OfferStatus.IN_DELIVERY)
        .order_by(desc(models.TradeOffer.responded_at))
        .all()
    )
    out = []
    for o in offers:
        lst    = db.get(models.CropListing, o.listing_id)
        farmer = db.get(models.FarmerProfile, lst.farmer_id) if lst else None
        out.append(_offer_to_out(o, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="buyer", db=db))
    return out


@router.get("/offers/orders", response_model=List[OfferOut])
def list_my_orders(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """
    Buyer's PAST completed orders — only COMPLETED (delivered & confirmed).
    In-transit ones live under /offers/delivery instead.

    Legacy ACCEPTED rows (from before the OTP flow existed) are treated as
    completed too so historical UX isn't broken.
    """
    offers = (
        db.query(models.TradeOffer)
        .filter(models.TradeOffer.buyer_id == str(buyer.id))
        .filter(models.TradeOffer.status.in_([
            models.OfferStatus.COMPLETED,
            models.OfferStatus.ACCEPTED,           # legacy — treat as done
        ]))
        .filter((models.TradeOffer.hidden_from_buyer.is_(None))
                | (models.TradeOffer.hidden_from_buyer == False))
        .order_by(desc(models.TradeOffer.responded_at))
        .all()
    )
    out = []
    for o in offers:
        lst    = db.get(models.CropListing, o.listing_id)
        farmer = db.get(models.FarmerProfile, lst.farmer_id) if lst else None
        out.append(_offer_to_out(o, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="buyer", db=db))
    return out


@router.post("/offers/{offer_id}/withdraw", response_model=OfferOut)
def withdraw_offer(
    offer_id: str,
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    offer = db.get(models.TradeOffer, offer_id)
    if not offer or str(offer.buyer_id) != str(buyer.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found")
    if offer.status != models.OfferStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only pending offers can be withdrawn")
    offer.status = models.OfferStatus.WITHDRAWN
    offer.responded_at = datetime.utcnow()
    lst    = db.get(models.CropListing, offer.listing_id)
    farmer = db.get(models.FarmerProfile, lst.farmer_id) if lst else None
    if lst:
        notify(
            db, recipient_id=str(lst.farmer_id), role="farmer",
            kind="OFFER_WITHDRAWN",
            title=f"Offer on {lst.crop_name} was withdrawn · ಬಿಡ್ ಹಿಂಪಡೆದಿದೆ",
            body=(
                f"{buyer.shop_name or 'The buyer'} pulled back their "
                f"₹{float(offer.offered_price_per_kg):.2f}/kg offer. "
                f"ಖರೀದಿದಾರರು ಪ್ರತಿ ಕೆ.ಜಿ.ಗೆ "
                f"₹{float(offer.offered_price_per_kg):.2f} ಬಿಡ್ ಹಿಂತೆಗೆದುಕೊಂಡಿದ್ದಾರೆ."
            ),
            deep_link=f"/market?listingId={lst.id}",
        )
    db.commit()
    db.refresh(offer)
    return _offer_to_out(offer, listing=lst, buyer=buyer, farmer=farmer, reveal_otp_to="buyer", db=db)


# ── Benchmark endpoint ──────────────────────────────────────────────────────

@router.get("/price-benchmarks/{crop_name}/{district}", response_model=BenchmarkOut)
def get_benchmark(
    crop_name: str,
    district:  str,
    db: Session = Depends(database.get_db),
):
    """Live price hint for the create-listing screen. Returns cached value with
    freshness metadata so the UI can show 'updated X hours ago' when stale."""
    row = _get_or_fetch_benchmark(crop_name, district, db)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={
            "error": "no_benchmark",
            "message": f"No benchmark price cached for {crop_name} in {district}. "
                       f"Listing can proceed but will be marked unverified.",
        })
    age = datetime.utcnow() - row.fetched_at if row.fetched_at else timedelta(0)
    return BenchmarkOut(
        crop_name       = row.crop_name,
        district        = row.district,
        benchmark_price = float(row.benchmark_price),
        source          = row.source,
        fetched_at      = row.fetched_at,
        ttl_hours       = BENCHMARK_TTL_HRS,
        stale           = age > timedelta(hours=BENCHMARK_TTL_HRS),
    )


# ── Auto-price-fit suggestion (Hyperlocal Commerce · auto-APMC) ────────────

@router.get("/pricing/suggest")
def suggest_price(
    crop: str  = Query(..., description="Crop name, e.g. 'Tomato'"),
    lat:  float = Query(..., ge=-90, le=90),
    lon:  float = Query(..., ge=-180, le=180),
    max_km: float = Query(300.0, description="Max distance to walk before giving up"),
    db: Session = Depends(database.get_db),
):
    """
    Fit a suggested price for a listing:

      1. Rank every seeded APMC by haversine distance from (lat, lon).
      2. Walk outward — for each APMC in distance order, look up TODAY's
         KMV price for this crop. First hit wins.
      3. If no KMV hit within max_km, fall back to data.gov.in (AGMARKNET)
         for the farmer's state.
      4. If both empty → status="unavailable". Farmer types manually
         (per the app's no-fabricated-prices rule).

    Replaces the deleted `/api/v1/pricing/smart-price` endpoint that used to
    return a hardcoded per-crop base rate (which was the same for every farmer
    everywhere — a trust-breaker).
    """
    from data.apmc_locations import APMC_LOCATIONS
    from price.proximity import haversine_km

    # Order every mapped APMC by distance from the farmer's GPS.
    ranked: list[tuple[float, str, dict]] = []
    for key, loc in APMC_LOCATIONS.items():
        d = haversine_km(lat, lon, loc["lat"], loc["lon"])
        if d <= max_km:
            ranked.append((d, key, loc))
    ranked.sort(key=lambda t: t[0])

    # Walk KMV cache outward until we find one with this crop today.
    crop_q = crop.strip()
    hop = 0
    for dist_km, market_key, loc in ranked:
        hop += 1
        # Look up any cached KMV row for this market + crop (allow last 7 days
        # — a listing today can honestly be anchored to yesterday's auction).
        cutoff = date.today() - timedelta(days=7)
        row = (
            db.query(models.KmvPriceCache)
            .filter(models.KmvPriceCache.commodity.ilike(f"%{crop_q}%"))
            .filter(models.KmvPriceCache.arrival_date >= cutoff)
            # Match this specific market (KMV names are ALL CAPS; normalize)
            .filter(
                func.replace(func.replace(func.lower(models.KmvPriceCache.market), ' ', ''), '.', '')
                    .like(f"%{market_key}%")
            )
            .order_by(desc(models.KmvPriceCache.arrival_date))
            .first()
        )
        if row is None:
            continue
        return {
            "status":              "ok",
            "crop":                crop_q,
            "suggested_price_kg":  round(float(row.modal_price_kg), 2),
            "min_price_kg":        round(float(row.min_price_kg),   2),
            "max_price_kg":        round(float(row.max_price_kg),   2),
            "apmc": {
                "name":         market_key.title(),
                "district":     loc["district"],
                "state":        loc["state"],
                "distance_km":  round(dist_km, 1),
            },
            "source":              "kmv",
            "arrival_date":        row.arrival_date.strftime("%d/%m/%Y") if row.arrival_date else None,
            "hop_count":           hop,
        }

    # KMV exhausted. Fall back to data.gov.in for the farmer's state (derive
    # from nearest seeded APMC's state, since we don't have a reverse-geocoder).
    farmer_state = ranked[0][2]["state"] if ranked else None
    if farmer_state:
        try:
            live = _fetch_agmarknet_price(crop_q, ranked[0][2]["district"])
            if live is not None:
                return {
                    "status":              "ok",
                    "crop":                crop_q,
                    "suggested_price_kg":  round(float(live), 2),
                    "min_price_kg":        None,
                    "max_price_kg":        None,
                    "apmc": {
                        "name":         ranked[0][2]["district"] + " district",
                        "district":     ranked[0][2]["district"],
                        "state":        farmer_state,
                        "distance_km":  round(ranked[0][0], 1),
                    },
                    "source":              "agmarknet",
                    "arrival_date":        None,
                    "hop_count":           len(ranked),
                }
        except Exception:
            pass  # fall through to unavailable

    return {
        "status":  "unavailable",
        "crop":    crop_q,
        "reason":  f"No APMC within {int(max_km)} km has posted a {crop_q} price recently.",
        "hint":    "Enter your best price manually — we'll still record the listing.",
    }
