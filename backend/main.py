from __future__ import annotations

import math
import os
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

import models
import schemas
import database
from home_endpoints import router as home_router
from sensor_endpoints import router as sensor_router
from bi_endpoints import router as bi_router
from commerce_endpoints import router as commerce_router
from notifications import router as notifications_router
from auth import OTPStore
from dependencies import (
    get_current_buyer,
    get_current_farmer,
    get_jwt_service,
)

# ─── Application ─────────────────────────────────────────────────────────────

app = FastAPI(title="KisanShakti API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(home_router)
app.include_router(sensor_router)
app.include_router(bi_router)
app.include_router(commerce_router)
app.include_router(notifications_router)

# Serve listing photos publicly. Path relative to this file so it works
# regardless of the shell's cwd when uvicorn starts.
_uploads_dir = Path(__file__).parent / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

# ─── Init DB tables on startup ───────────────────────────────────────────────

@app.on_event("startup")
def create_tables():
    database.Base.metadata.create_all(bind=database.engine)
    # Auto-migrate: add any columns missing from an older DB (SQLite-only)
    if database._is_sqlite:
        with database.engine.connect() as conn:
            existing = {row[1] for row in conn.exec_driver_sql(
                "PRAGMA table_info(farmer_profiles)"
            ).fetchall()}
            for col_ddl in [
                ("location_name", "ALTER TABLE farmer_profiles ADD COLUMN location_name TEXT"),
                ("latitude",      "ALTER TABLE farmer_profiles ADD COLUMN latitude NUMERIC"),
                ("longitude",     "ALTER TABLE farmer_profiles ADD COLUMN longitude NUMERIC"),
                ("cattle_count",  "ALTER TABLE farmer_profiles ADD COLUMN cattle_count INTEGER DEFAULT 0"),
            ]:
                if col_ddl[0] not in existing:
                    conn.exec_driver_sql(col_ddl[1])

            # farm_ledger: cycle_id + subcategory (Farm Business feature)
            ledger_cols = {row[1] for row in conn.exec_driver_sql(
                "PRAGMA table_info(farm_ledger)"
            ).fetchall()}
            for col_name, ddl in [
                ("cycle_id",    "ALTER TABLE farm_ledger ADD COLUMN cycle_id TEXT"),
                ("subcategory", "ALTER TABLE farm_ledger ADD COLUMN subcategory TEXT"),
            ]:
                if col_name not in ledger_cols:
                    conn.exec_driver_sql(ddl)

            # crop_listings: Hyperlocal Commerce Engine extensions
            listing_cols = {row[1] for row in conn.exec_driver_sql(
                "PRAGMA table_info(crop_listings)"
            ).fetchall()}
            for col_name, ddl in [
                ("plot_id",                    "ALTER TABLE crop_listings ADD COLUMN plot_id TEXT"),
                ("cycle_id",                   "ALTER TABLE crop_listings ADD COLUMN cycle_id TEXT"),
                ("crop_name_kn",               "ALTER TABLE crop_listings ADD COLUMN crop_name_kn TEXT"),
                ("latitude",                   "ALTER TABLE crop_listings ADD COLUMN latitude NUMERIC"),
                ("longitude",                  "ALTER TABLE crop_listings ADD COLUMN longitude NUMERIC"),
                ("benchmark_price_at_listing", "ALTER TABLE crop_listings ADD COLUMN benchmark_price_at_listing NUMERIC"),
                ("photo_path",                 "ALTER TABLE crop_listings ADD COLUMN photo_path TEXT"),
                ("village",                    "ALTER TABLE crop_listings ADD COLUMN village TEXT"),
                ("created_at",                 "ALTER TABLE crop_listings ADD COLUMN created_at DATETIME"),
                ("expires_at",                 "ALTER TABLE crop_listings ADD COLUMN expires_at DATETIME"),
                ("market_source_apmc",         "ALTER TABLE crop_listings ADD COLUMN market_source_apmc TEXT"),
                ("market_source_district",     "ALTER TABLE crop_listings ADD COLUMN market_source_district TEXT"),
                ("market_source_price_kg",     "ALTER TABLE crop_listings ADD COLUMN market_source_price_kg NUMERIC"),
                ("market_source_distance_km",  "ALTER TABLE crop_listings ADD COLUMN market_source_distance_km NUMERIC"),
                ("market_source_date",         "ALTER TABLE crop_listings ADD COLUMN market_source_date TEXT"),
            ]:
                if col_name not in listing_cols:
                    conn.exec_driver_sql(ddl)
            # Backfill: SQLite's `server_default=func.now()` fires only on
            # CREATE TABLE, so any existing rows have created_at NULL after
            # the ALTER above. A NULL there breaks the Pydantic response model.
            conn.exec_driver_sql(
                "UPDATE crop_listings SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL"
            )

            # trade_offers: delivery OTP + completion + cancellation fields
            offer_cols = {row[1] for row in conn.exec_driver_sql(
                "PRAGMA table_info(trade_offers)"
            ).fetchall()}
            for col_name, ddl in [
                ("delivery_otp",     "ALTER TABLE trade_offers ADD COLUMN delivery_otp TEXT"),
                ("completed_at",     "ALTER TABLE trade_offers ADD COLUMN completed_at DATETIME"),
                ("cancelled_reason", "ALTER TABLE trade_offers ADD COLUMN cancelled_reason TEXT"),
                ("hidden_from_buyer","ALTER TABLE trade_offers ADD COLUMN hidden_from_buyer INTEGER DEFAULT 0"),
            ]:
                if col_name not in offer_cols:
                    conn.exec_driver_sql(ddl)

            # Backfill: for every listing that has a legacy photo_path but no row
            # in listing_photos, seed a row as the primary (sort_order=0). Idempotent.
            conn.exec_driver_sql("""
                INSERT INTO listing_photos (id, listing_id, photo_path, sort_order, created_at)
                SELECT lower(hex(randomblob(16))), cl.id, cl.photo_path, 0, CURRENT_TIMESTAMP
                FROM crop_listings cl
                WHERE cl.photo_path IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM listing_photos lp WHERE lp.listing_id = cl.id
                  )
            """)
            # Backfill: an older verify-otp flow saved shop_name = phone_number
            # whenever the buyer signed up without entering a shop name. Blank
            # those out (empty string — the column has a NOT NULL constraint from
            # the original schema, and SQLite can't drop that without rebuilding
            # the table) so the app re-prompts for a real name via PATCH /buyers/me.
            # A row matches when shop_name equals its own phone_number, or when
            # shop_name is a pure-digit / +-digit string (i.e. clearly a phone).
            conn.exec_driver_sql("""
                UPDATE buyer_profiles
                SET shop_name = ''
                WHERE shop_name IS NOT NULL AND shop_name != '' AND (
                    shop_name = phone_number
                    OR (
                        length(replace(replace(shop_name, '+', ''), ' ', '')) >= 10
                        AND replace(replace(shop_name, '+', ''), ' ', '')
                            GLOB '[0-9]*'
                    )
                )
            """)

            # sensor_readings: battery telemetry columns (added Sep 2026)
            sensor_cols = {row[1] for row in conn.exec_driver_sql(
                "PRAGMA table_info(sensor_readings)"
            ).fetchall()}
            for col_name, ddl in [
                ("battery_v",   "ALTER TABLE sensor_readings ADD COLUMN battery_v NUMERIC"),
                ("battery_pct", "ALTER TABLE sensor_readings ADD COLUMN battery_pct INTEGER"),
            ]:
                if col_name not in sensor_cols:
                    conn.exec_driver_sql(ddl)

            conn.commit()

    # KMV price scheduler — refreshes Karnataka APMC data at 05:00 & 20:00 IST
    # daily, with a cold-start kick if the cache is empty. See scheduler.py.
    try:
        import scheduler as _sched
        _sched.start()
    except Exception as _e:
        # Non-fatal: API still serves what's in the cache; only the auto-refresh dies.
        import logging as _log
        _log.getLogger(__name__).warning("[startup] KMV scheduler did not start: %s", _e)

# ─── Singletons ──────────────────────────────────────────────────────────────

_otp_store = OTPStore()
_DEBUG = os.getenv("DEBUG", "").lower() in {"1", "true", "yes"}

# Delegates to the shared sliding-window limiter in rate_limit.py so every
# feature uses the same throttling primitive. OTP is more restrictive than
# most (paid SMS if we ever wire a real provider): 3/hr per phone, 10/hr per IP.
from rate_limit import check_rate as _check_rate

def _check_otp_rate(phone: str, ip: str) -> None:
    _check_rate(bucket="otp_phone", key=phone, cap=3, window_s=3600, friendly="OTP requests")
    _check_rate(bucket="otp_ip",    key=ip,    cap=10, window_s=3600, friendly="OTP requests")

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two (lat, lon) points."""
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)
    a = math.sin(Δφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# ─── Auth Schemas ─────────────────────────────────────────────────────────────

class SendOTPRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=15)
    role: Literal["farmer", "buyer"] = Field(...)

class SendOTPResponse(BaseModel):
    message: str
    dev_otp: Optional[str] = None

class VerifyOTPRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=15)
    otp: str = Field(..., min_length=6, max_length=6)
    role: Literal["farmer", "buyer"]
    name: Optional[str] = None

class VerifyOTPResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    is_new_user: bool
    # True when the client should show a "complete your profile" step:
    #   - genuinely new user, OR
    #   - buyer whose stored shop_name is missing or looks like a phone number
    #     (legacy fallback from an earlier build). Farmer profile completeness
    #     is tracked via the local SQLite `onboarded` flag instead.
    needs_profile: bool = False

class BuyerProfileUpdate(BaseModel):
    shop_name: str = Field(..., min_length=1, max_length=120)
    shop_type: Optional[str] = None
    sourcing_radius_km: Optional[float] = None

# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"message": "KisanShakti API", "version": "1.0.0"}

@app.get("/health")
def health_check(db: Session = Depends(database.get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/v1/auth/send-otp", response_model=SendOTPResponse)
def send_otp(body: SendOTPRequest, request: Request):
    client_ip = (request.client.host if request.client else "unknown")
    _check_otp_rate(body.phone, client_ip)
    code = _otp_store.generate(body.phone)
    # Always log the OTP to the backend terminal so devs can read it without
    # needing an SMS gateway. In production this line is fine because prod
    # doesn't run with a visible uvicorn terminal — real SMS delivery happens
    # via a separate integration (Twilio/MSG91 not wired in yet).
    print(f"[OTP] {body.role} · {body.phone} → {code}", flush=True)
    response = SendOTPResponse(message="OTP sent successfully")
    if _DEBUG:
        response.dev_otp = code
    return response


@app.post("/api/v1/auth/verify-otp", response_model=VerifyOTPResponse)
def verify_otp(body: VerifyOTPRequest, db: Session = Depends(database.get_db)):
    if not _otp_store.verify(body.phone, body.otp):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP. Please request a new code.",
        )

    is_new_user = False

    if body.role == "farmer":
        farmer = db.query(models.FarmerProfile).filter_by(phone_number=body.phone).first()
        if farmer is None:
            is_new_user = True
            farmer = models.FarmerProfile(
                id=str(uuid.uuid4()),
                phone_number=body.phone,
                full_name=body.name or body.phone,
                total_land_ha=0.0,
                cattle_count=0,
            )
            db.add(farmer)
            db.commit()
            db.refresh(farmer)
        user_id = str(farmer.id)

    else:
        buyer = db.query(models.BuyerProfile).filter_by(phone_number=body.phone).first()
        if buyer is None:
            is_new_user = True
            # Do NOT fall back shop_name to the phone number — that made the
            # farmer's inbox show phones instead of shop names. Leave it as a
            # sentinel-looking placeholder; the buyer will fill it via the
            # PATCH /buyers/me call the app fires from the profile step.
            # Column has NOT NULL from the original schema — use empty string
            # as the sentinel for "not set yet". The needs_profile check
            # below treats "" the same as missing, so the app prompts for
            # a real shop name on first login.
            buyer = models.BuyerProfile(
                id=str(uuid.uuid4()),
                phone_number=body.phone,
                shop_name=(body.name or "").strip(),
                shop_type=models.ShopType.KIRANA,
                sourcing_radius_km=10,
                shop_location="13.1367,78.1325",
            )
            db.add(buyer)
            db.commit()
            db.refresh(buyer)
        user_id = str(buyer.id)

    # Compute needs_profile: buyer without a real shop_name (missing, blank, or
    # legacy fallback to the phone number) must complete their profile before
    # they show up in farmers' inboxes as anything but "Buyer".
    needs_profile = is_new_user
    if body.role == "buyer" and not needs_profile:
        sn = (buyer.shop_name or "").strip()
        if not sn or sn == body.phone or sn.lstrip("+").isdigit():
            needs_profile = True

    jwt_service = get_jwt_service()
    token = jwt_service.create_token(user_id=user_id, phone=body.phone, role=body.role)
    return VerifyOTPResponse(
        access_token=token, token_type="bearer",
        user_id=user_id, is_new_user=is_new_user, needs_profile=needs_profile,
    )

# ─── Farmer Profile ───────────────────────────────────────────────────────────

@app.get("/api/v1/farmers/me")
def get_my_farmer_profile(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Return the caller's farmer profile with every field coerced defensively.
    A previous version threw uncaught 500s on farmer rows where a Numeric
    column happened to arrive as None (partial-onboarding artefacts, seed-
    script inserts pre-auto-migration, etc.). Now: every field is None-
    guarded, any unexpected exception in the crop-list build path is logged
    with a full traceback and swallowed to an empty list so the profile
    still loads.
    """
    def _f(v):
        """Coerce Numeric-like column to float, tolerating None or garbage."""
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    try:
        crops = db.query(models.FarmerCrop).filter_by(farmer_id=str(farmer.id)).all()
        crop_out = [
            {
                "id":           str(c.id),
                "crop_name":    c.crop_name,
                "crop_name_kn": c.crop_name_kn,
                "land_ha":      _f(c.land_ha) or 0.0,
            } for c in crops
        ]
    except Exception as e:
        import traceback, logging
        logging.getLogger(__name__).error(
            "[/farmers/me] crop-list load failed for %s: %s\n%s",
            farmer.id, e, traceback.format_exc(),
        )
        crop_out = []

    return {
        "id":            str(farmer.id),
        "phone_number":  farmer.phone_number,
        "full_name":     farmer.full_name or "",
        "total_land_ha": _f(farmer.total_land_ha) or 0.0,
        "cattle_count":  int(farmer.cattle_count) if farmer.cattle_count is not None else 0,
        "location_name": farmer.location_name,
        "latitude":      _f(farmer.latitude),
        "longitude":     _f(farmer.longitude),
        "crops":         crop_out,
    }


# ── Extended profile update (onboarding) ────────────────────────────────────

class CropInput(BaseModel):
    crop_name: str
    crop_name_kn: Optional[str] = None
    land_ha: float


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    total_land_ha: Optional[float] = None
    cattle_count: Optional[int] = None
    crops: Optional[List[CropInput]] = None  # replaces all existing crops


@app.put("/api/v1/farmers/profile")
def update_farmer_profile(
    body: UpdateProfileRequest,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    if body.full_name is not None:      farmer.full_name = body.full_name
    if body.location_name is not None:  farmer.location_name = body.location_name
    if body.latitude is not None:       farmer.latitude = body.latitude
    if body.longitude is not None:      farmer.longitude = body.longitude
    if body.total_land_ha is not None:  farmer.total_land_ha = body.total_land_ha
    if body.cattle_count is not None:   farmer.cattle_count = body.cattle_count

    if body.crops is not None:
        db.query(models.FarmerCrop).filter_by(farmer_id=str(farmer.id)).delete()
        for c in body.crops:
            db.add(models.FarmerCrop(
                id=str(uuid.uuid4()),
                farmer_id=str(farmer.id),
                crop_name=c.crop_name,
                crop_name_kn=c.crop_name_kn,
                land_ha=c.land_ha,
            ))

    db.commit()
    db.refresh(farmer)
    return {"status": "updated", "id": str(farmer.id)}

# Legacy unauth'd registration route removed (Sep 2026). Sign-up now goes
# through POST /api/v1/auth/verify-otp which creates the farmer row after
# proving phone ownership. Keeping the route open allowed anyone to POST
# arbitrary phone numbers and manufacture farmer rows.
@app.post("/api/v1/farmers/register", deprecated=True, include_in_schema=False)
def register_farmer_deprecated():
    raise HTTPException(
        status.HTTP_410_GONE,
        "Farmer registration is now handled by /api/v1/auth/verify-otp.",
    )


@app.delete("/api/v1/farmers/me", status_code=status.HTTP_200_OK)
def delete_my_farmer_account(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Right-to-be-forgotten: cascade-deletes the caller's farmer profile and
    EVERY row that references them. Required for Play Store compliance
    ("account deletion request"). Irreversible.

    Cascade order matters (children before parents) because we don't rely
    on ON DELETE CASCADE — the existing schema was built without those
    constraints. Everything runs in a single transaction so a mid-flight
    failure leaves the account intact.

    NOTE: listings authored by this farmer disappear entirely, which means
    buyers who had pending or completed offers against them lose those
    historical references. This matches user expectations for account
    deletion ("nothing of mine remains") and is stricter than needed for
    compliance — swap for anonymisation later if we surface transaction
    history to buyers.
    """
    fid = str(farmer.id)
    try:
        # 1. Ratings this farmer received (and cascades to listing ratings)
        db.execute(text("DELETE FROM farmer_ratings WHERE farmer_id = :fid"), {"fid": fid})
        # 2. Offers made against this farmer's listings — collect listing ids first
        listing_ids = [
            row[0] for row in db.execute(
                text("SELECT id FROM crop_listings WHERE farmer_id = :fid"), {"fid": fid}
            ).fetchall()
        ]
        if listing_ids:
            for lid in listing_ids:
                db.execute(text("DELETE FROM trade_offers   WHERE listing_id = :lid"), {"lid": lid})
                db.execute(text("DELETE FROM listing_photos WHERE listing_id = :lid"), {"lid": lid})
        # 3. Listings themselves
        db.execute(text("DELETE FROM crop_listings         WHERE farmer_id = :fid"), {"fid": fid})
        # 4. Farm business — cycles, plots, ledger
        db.execute(text("DELETE FROM crop_cycles           WHERE logged_by_farmer_id = :fid"), {"fid": fid})
        # plots via ownership history
        plot_ids = [
            row[0] for row in db.execute(
                text("SELECT id FROM plots WHERE current_owner_farmer_id = :fid"), {"fid": fid}
            ).fetchall()
        ]
        for pid in plot_ids:
            db.execute(text("DELETE FROM plot_ownership_history WHERE plot_id = :pid"), {"pid": pid})
        db.execute(text("DELETE FROM plots                 WHERE current_owner_farmer_id = :fid"), {"fid": fid})
        db.execute(text("DELETE FROM farm_ledger           WHERE farmer_id = :fid"), {"fid": fid})
        # 5. Sensor stack
        db.execute(text("DELETE FROM sensor_readings       WHERE farmer_id = :fid"), {"fid": fid})
        db.execute(text("DELETE FROM sensor_devices        WHERE farmer_id = :fid"), {"fid": fid})
        # 6. Notifications addressed to this farmer
        db.execute(text("DELETE FROM notifications         WHERE recipient_id = :fid AND recipient_role = 'farmer'"), {"fid": fid})
        # 7. Onboarded-crops list
        db.execute(text("DELETE FROM farmer_crops          WHERE farmer_id = :fid"), {"fid": fid})
        # 8. Finally the profile row itself
        db.execute(text("DELETE FROM farmer_profiles       WHERE id = :fid"), {"fid": fid})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Account deletion failed: {type(e).__name__}. Nothing was deleted.",
        )
    return {"status": "deleted", "id": fid}


@app.delete("/api/v1/buyers/me", status_code=status.HTTP_200_OK)
def delete_my_buyer_account(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """
    Right-to-be-forgotten for buyers. Same policy as the farmer flow —
    everything owned by the buyer is deleted in a single transaction.
    """
    bid = str(buyer.id)
    try:
        # Offers this buyer made
        db.execute(text("DELETE FROM trade_offers    WHERE buyer_id = :bid"), {"bid": bid})
        # Ratings this buyer gave
        db.execute(text("DELETE FROM farmer_ratings  WHERE buyer_id = :bid"), {"bid": bid})
        # Notifications addressed to them
        db.execute(text("DELETE FROM notifications   WHERE recipient_id = :bid AND recipient_role = 'buyer'"), {"bid": bid})
        # Finally the profile row itself
        db.execute(text("DELETE FROM buyer_profiles  WHERE id = :bid"), {"bid": bid})
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Account deletion failed: {type(e).__name__}. Nothing was deleted.",
        )
    return {"status": "deleted", "id": bid}

# ─── Buyer Profile ────────────────────────────────────────────────────────────

@app.get("/api/v1/buyers/me")
def get_my_buyer_profile(buyer: models.BuyerProfile = Depends(get_current_buyer)):
    return {
        "id": str(buyer.id),
        "phone_number": buyer.phone_number,
        "shop_name": buyer.shop_name,
        "shop_type": buyer.shop_type,
        "sourcing_radius_km": float(buyer.sourcing_radius_km),
    }


@app.patch("/api/v1/buyers/me")
def update_my_buyer_profile(
    body: BuyerProfileUpdate,
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db: Session = Depends(database.get_db),
):
    """Buyer completes/edits their own profile. Used from Mandi's login-time
    profile step (after OTP verified) and from a future Settings screen."""
    buyer.shop_name = body.shop_name.strip()
    if body.shop_type:
        try:
            buyer.shop_type = models.ShopType(body.shop_type)
        except ValueError:
            # Unknown enum value — leave the existing type in place rather than 500.
            pass
    if body.sourcing_radius_km is not None:
        buyer.sourcing_radius_km = body.sourcing_radius_km
    db.commit()
    db.refresh(buyer)
    return {
        "id": str(buyer.id),
        "phone_number": buyer.phone_number,
        "shop_name": buyer.shop_name,
        "shop_type": buyer.shop_type,
        "sourcing_radius_km": float(buyer.sourcing_radius_km),
    }

# Removed /api/v1/buyers/preferences — was a no-op stub that took shop_type
# and sourcing_radius_km from the QUERY string with no auth. Real buyer
# preferences are set via PATCH /api/v1/buyers/me.

# ─── Crop Listings ────────────────────────────────────────────────────────────

@app.get("/api/v1/crops/nearby")
def get_nearby_crops(
    latitude: float,
    longitude: float,
    radius_km: float = 25.0,
    db: Session = Depends(database.get_db),
):
    rows = (
        db.query(models.CropListing, models.FarmerProfile)
        .join(models.FarmerProfile, models.CropListing.farmer_id == models.FarmerProfile.id)
        .filter(models.CropListing.status == models.CropStatus.AVAILABLE)
        .all()
    )

    crops = []
    for listing, farmer in rows:
        try:
            lat_s, lon_s = listing.location.split(",")
            dist = _haversine_km(latitude, longitude, float(lat_s), float(lon_s))
        except Exception:
            dist = 0.0
        if dist <= radius_km:
            crops.append({
                "id": str(listing.id),
                "farmer_id": str(listing.farmer_id),
                "crop_name": listing.crop_name,
                "quantity_kg": float(listing.quantity_kg),
                "calculated_price_per_kg": float(listing.calculated_price_per_kg),
                "status": listing.status,
                "distance_km": round(dist, 1),
                "farmer_name": farmer.full_name,
                "farmer_phone": farmer.phone_number,
            })

    crops.sort(key=lambda x: x["distance_km"])
    return crops[:50]


class CreateListingRequest(BaseModel):
    crop_name: str
    quantity_kg: float
    calculated_price_per_kg: float
    latitude: float = 13.1367
    longitude: float = 78.1325


@app.post("/api/v1/crops/listing")
def create_crop_listing(
    body: CreateListingRequest,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    listing = models.CropListing(
        id=str(uuid.uuid4()),
        farmer_id=str(farmer.id),
        crop_name=body.crop_name,
        quantity_kg=body.quantity_kg,
        calculated_price_per_kg=body.calculated_price_per_kg,
        status=models.CropStatus.AVAILABLE,
        location=f"{body.latitude},{body.longitude}",
    )
    db.add(listing)
    db.commit()
    return {"status": "listed", "listing_id": str(listing.id)}

# /api/v1/pricing/smart-price was removed — it returned hardcoded per-crop
# base rates that ignored the farmer's location and today's actual mandi data.
# Replaced by GET /api/v1/pricing/suggest?crop=&lat=&lon= (in commerce_endpoints.py)
# which walks the nearest APMCs via KMV cache / data.gov.in and fits a real,
# location-aware price. See memory: feedback-no-hardcoded-farmer-data.

# ─── Farm Ledger ──────────────────────────────────────────────────────────────

@app.get("/api/v1/farm-ledger")
def get_farm_ledger(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    rows = (
        db.query(models.FarmLedger)
        .filter_by(farmer_id=str(farmer.id))
        .order_by(models.FarmLedger.timestamp.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": str(r.id),
            "transaction_type": r.transaction_type,
            "amount": float(r.amount),
            "category": r.category,
            "timestamp": r.timestamp.strftime("%Y-%m-%d") if r.timestamp else "",
        }
        for r in rows
    ]


class LedgerEntryRequest(BaseModel):
    transaction_type: Literal["INCOME", "EXPENSE"]
    amount: float
    category: str


@app.post("/api/v1/farm-ledger")
def add_ledger_entry(
    body: LedgerEntryRequest,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    entry = models.FarmLedger(
        id=str(uuid.uuid4()),
        farmer_id=str(farmer.id),
        transaction_type=body.transaction_type,
        amount=body.amount,
        category=body.category,
        timestamp=datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    return {"status": "recorded", "id": str(entry.id)}
