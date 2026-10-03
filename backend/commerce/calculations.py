"""
Pure functions for the Hyperlocal Commerce Engine.

Everything DB-free and I/O-free. Endpoints in commerce_endpoints.py hydrate
ORM rows into plain dataclasses and call these functions.

Rules baked in:
  * Prices outside ±5% of the AGMARKNET benchmark are rejected at the API
    layer, not just the UI.
  * Ranking combines distance (60%) and price-fairness (40%).
  * If no benchmark exists at all for a crop, listings can still be created
    but are flagged as "unverified" — never silently skip the safeguard.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional


# ── Tunable constants (named, not magic numbers) ────────────────────────────

PRICE_WINDOW_PCT   = 0.05         # ±5% around the AGMARKNET benchmark
DISTANCE_WEIGHT    = 0.60         # weight for distance in relevance score
PRICE_WEIGHT       = 0.40         # weight for price fairness in relevance score
DEFAULT_RADIUS_KM  = 25.0
EARTH_RADIUS_KM    = 6371.0
BENCHMARK_TTL_HRS  = 6            # AGMARKNET cache lifetime
OFFER_TTL_HOURS    = 48           # buyer counter-offers expire 48h


# ── Data shapes ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ListingSnapshot:
    id:           str
    crop_name:    str
    price_per_kg: float
    quantity_kg:  float
    latitude:     float
    longitude:    float


@dataclass(frozen=True)
class RankedListing:
    listing:          ListingSnapshot
    distance_km:      float
    benchmark_price:  Optional[float]         # None when no benchmark cached
    distance_score:   float
    price_score:      float
    relevance_score:  float
    fair_price:       bool                    # true when within ±2.5% of benchmark


# ── 1. Haversine distance ───────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Great-circle distance in kilometres between two (lat, lon) points.

    Kept in application code because dev runs SQLite (no PostGIS). In
    production Postgres with PostGIS this is replaced by ST_DWithin +
    ST_Distance on a `geography` column with a GiST index — see the
    README migration note. The math is identical either way.
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── 2. Price window validation ──────────────────────────────────────────────

@dataclass(frozen=True)
class PriceValidation:
    ok:              bool
    floor:           Optional[float]          # None when no benchmark
    ceiling:         Optional[float]
    benchmark_price: Optional[float]
    reason:          Optional[str]            # human-readable when not ok
    verified:        bool                     # false when no benchmark cached


def validate_price(
    price_per_kg:      float,
    benchmark_price:   Optional[float],
) -> PriceValidation:
    """
    Enforce the ±5% window at the API layer.

    Three outcomes:
      * benchmark exists AND price within window  → ok=True, verified=True
      * benchmark exists AND price outside window → ok=False, verified=True
      * no benchmark cached at all               → ok=True, verified=False
        (allow the trade, but the listing is flagged 'unverified' — never
         silently drop the safeguard, per spec)
    """
    if price_per_kg <= 0:
        return PriceValidation(
            ok=False, floor=None, ceiling=None,
            benchmark_price=benchmark_price,
            reason="Price must be greater than zero.",
            verified=benchmark_price is not None,
        )

    if benchmark_price is None:
        return PriceValidation(
            ok=True, floor=None, ceiling=None,
            benchmark_price=None,
            reason=None,
            verified=False,
        )

    floor   = round(benchmark_price * (1 - PRICE_WINDOW_PCT), 2)
    ceiling = round(benchmark_price * (1 + PRICE_WINDOW_PCT), 2)

    if price_per_kg < floor:
        return PriceValidation(
            ok=False, floor=floor, ceiling=ceiling,
            benchmark_price=benchmark_price,
            reason=(
                f"Price ₹{price_per_kg:.2f}/kg is below the fair range "
                f"(₹{floor:.2f}–₹{ceiling:.2f}) for this crop today."
            ),
            verified=True,
        )
    if price_per_kg > ceiling:
        return PriceValidation(
            ok=False, floor=floor, ceiling=ceiling,
            benchmark_price=benchmark_price,
            reason=(
                f"Price ₹{price_per_kg:.2f}/kg is above the fair range "
                f"(₹{floor:.2f}–₹{ceiling:.2f}) for this crop today."
            ),
            verified=True,
        )
    return PriceValidation(
        ok=True, floor=floor, ceiling=ceiling,
        benchmark_price=benchmark_price,
        reason=None,
        verified=True,
    )


# ── 3. Relevance scoring ────────────────────────────────────────────────────

def _distance_score(distance_km: float, radius_km: float) -> float:
    """Closer = higher. Guarded against zero-distance (same village) → 1.0."""
    if radius_km <= 0:
        return 0.0
    if distance_km <= 0:
        return 1.0
    if distance_km >= radius_km:
        return 0.0
    return max(0.0, 1.0 - (distance_km / radius_km))


def _price_score(price: float, benchmark: Optional[float]) -> float:
    """
    Closer to benchmark = higher. When no benchmark exists we return 0.5 so
    "unverified" listings sit mid-pack instead of pretending to be perfect
    (score 1.0) or worst (score 0.0).
    """
    if benchmark is None or benchmark <= 0:
        return 0.5
    diff = abs(price - benchmark)
    window = benchmark * PRICE_WINDOW_PCT
    if window <= 0:
        return 0.5
    # Anything at the edge of the ±5% window scores 0; at exactly the
    # benchmark scores 1. Beyond the window (shouldn't reach ranking, but
    # defensive) also scores 0.
    return max(0.0, min(1.0, 1.0 - diff / window))


def rank_listings(
    listings:        Iterable[ListingSnapshot],
    buyer_lat:       float,
    buyer_lng:       float,
    radius_km:       float,
    benchmark_by_crop: dict[str, Optional[float]],
) -> list[RankedListing]:
    """
    Filter listings to those within radius_km of the buyer, score each by
    (distance × 0.6) + (price × 0.4), sort descending. Deterministic tie-break
    on listing.id keeps output stable across identical scores.
    """
    if radius_km <= 0:
        radius_km = DEFAULT_RADIUS_KM

    out: list[RankedListing] = []
    for lst in listings:
        d = haversine_km(buyer_lat, buyer_lng, lst.latitude, lst.longitude)
        if d > radius_km:
            continue
        benchmark = benchmark_by_crop.get(lst.crop_name)
        ds = _distance_score(d, radius_km)
        ps = _price_score(lst.price_per_kg, benchmark)
        score = round(ds * DISTANCE_WEIGHT + ps * PRICE_WEIGHT, 4)
        fair = False
        if benchmark is not None and benchmark > 0:
            fair = abs(lst.price_per_kg - benchmark) <= benchmark * (PRICE_WINDOW_PCT / 2)
        out.append(RankedListing(
            listing=lst, distance_km=round(d, 2),
            benchmark_price=benchmark,
            distance_score=round(ds, 4), price_score=round(ps, 4),
            relevance_score=score, fair_price=fair,
        ))
    out.sort(key=lambda r: (-r.relevance_score, r.listing.id))
    return out
