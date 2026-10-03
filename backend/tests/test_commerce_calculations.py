"""
Unit tests for backend/commerce/calculations.py.

Every test hits a specific spec rule — the comment on each says which one.
Fixtures are minimal dataclasses (no DB, no HTTP) so the suite runs in
milliseconds and can't drift with schema changes.
"""
from __future__ import annotations

import pytest

from commerce.calculations import (
    ListingSnapshot,
    PRICE_WINDOW_PCT,
    haversine_km,
    rank_listings,
    validate_price,
)


def _l(id="l1", crop="Tomato", price=20.0, qty=50.0, lat=13.14, lng=78.13) -> ListingSnapshot:
    return ListingSnapshot(
        id=id, crop_name=crop, price_per_kg=price, quantity_kg=qty,
        latitude=lat, longitude=lng,
    )


# ── validate_price ──────────────────────────────────────────────────────────

def test_validate_price_within_window_passes():
    v = validate_price(price_per_kg=20.0, benchmark_price=20.0)
    assert v.ok is True
    assert v.verified is True


def test_validate_price_at_lower_boundary_passes():
    v = validate_price(price_per_kg=19.0, benchmark_price=20.0)   # exactly -5%
    assert v.ok is True
    assert v.floor == 19.0


def test_validate_price_at_upper_boundary_passes():
    v = validate_price(price_per_kg=21.0, benchmark_price=20.0)   # exactly +5%
    assert v.ok is True
    assert v.ceiling == 21.0


def test_validate_price_below_floor_rejects_with_range_in_message():
    v = validate_price(price_per_kg=18.0, benchmark_price=20.0)
    assert v.ok is False
    assert v.verified is True
    assert "19.00" in v.reason and "21.00" in v.reason


def test_validate_price_above_ceiling_rejects():
    v = validate_price(price_per_kg=22.0, benchmark_price=20.0)
    assert v.ok is False


def test_validate_price_zero_or_negative_rejects():
    assert validate_price(0,  20.0).ok is False
    assert validate_price(-1, 20.0).ok is False


def test_validate_price_no_benchmark_allows_but_flags_unverified():
    """Spec: if no benchmark cached, allow the listing but flag it."""
    v = validate_price(price_per_kg=20.0, benchmark_price=None)
    assert v.ok is True
    assert v.verified is False
    assert v.floor is None
    assert v.ceiling is None


# ── haversine_km ────────────────────────────────────────────────────────────

def test_haversine_same_point_is_zero():
    assert haversine_km(13.14, 78.13, 13.14, 78.13) == pytest.approx(0.0, abs=0.01)


def test_haversine_known_distance():
    # Bangalore ~ Kolar: ~70 km
    d = haversine_km(12.97, 77.59, 13.14, 78.13)
    assert 55 < d < 90


# ── rank_listings ───────────────────────────────────────────────────────────

def test_rank_listings_filters_outside_radius():
    close = _l(id="close", lat=13.14,  lng=78.13)              # 0 km
    far   = _l(id="far",   lat=15.00,  lng=80.00)              # ~250 km
    out = rank_listings(
        [close, far], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=25.0, benchmark_by_crop={"Tomato": 20.0},
    )
    assert [r.listing.id for r in out] == ["close"]


def test_rank_listings_near_and_fair_beats_far_and_fair():
    """Distance weighs 60%: closer beats farther when price fairness is equal."""
    near = _l(id="near", price=20.0, lat=13.14,  lng=78.13)     # 0 km, benchmark
    far  = _l(id="far",  price=20.0, lat=13.30,  lng=78.30)     # ~25 km, benchmark
    out = rank_listings(
        [near, far], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=30.0, benchmark_by_crop={"Tomato": 20.0},
    )
    assert out[0].listing.id == "near"


def test_rank_listings_near_beats_slightly_farther_cheaper():
    """
    Spec: relevance = 0.6*distance + 0.4*price. A near listing at benchmark
    should outrank a somewhat-farther listing at the cheapest legal price,
    because distance dominates.
    """
    near_fair = _l(id="near_fair", price=20.0, lat=13.14, lng=78.13)   # 0 km
    far_cheap = _l(id="far_cheap", price=19.0, lat=13.24, lng=78.23)   # ~15 km
    out = rank_listings(
        [near_fair, far_cheap], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=25.0, benchmark_by_crop={"Tomato": 20.0},
    )
    assert out[0].listing.id == "near_fair"


def test_rank_listings_same_village_no_divide_by_zero():
    """Spec edge case: buyer and farmer identical GPS shouldn't crash."""
    same = _l(id="same", price=20.0, lat=13.14, lng=78.13)
    out = rank_listings(
        [same], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=25.0, benchmark_by_crop={"Tomato": 20.0},
    )
    assert out[0].distance_score == 1.0
    assert out[0].relevance_score > 0


def test_rank_listings_unverified_price_scores_midpack():
    """A listing whose crop has no cached benchmark should get price_score=0.5,
    NOT 1.0 (would pretend to be perfect) or 0 (would sink to the bottom)."""
    unverified = _l(id="u", crop="ObscureCrop", price=15.0, lat=13.14, lng=78.13)
    out = rank_listings(
        [unverified], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=25.0, benchmark_by_crop={},
    )
    assert out[0].price_score == 0.5
    assert out[0].benchmark_price is None


def test_rank_listings_fair_price_flag_within_2_5pct():
    """Fair-price badge fires only within ±2.5% of the benchmark, not the full 5%."""
    dead_on = _l(id="dead_on", price=20.0)
    edge    = _l(id="edge",    price=20.8)     # +4% — inside 5% window, outside 2.5%
    out = rank_listings(
        [dead_on, edge], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=25.0, benchmark_by_crop={"Tomato": 20.0},
    )
    by_id = {r.listing.id: r for r in out}
    assert by_id["dead_on"].fair_price is True
    assert by_id["edge"].fair_price is False


def test_rank_listings_deterministic_tiebreak_on_id():
    """Two listings with identical score should sort by id ascending for stable output."""
    a = _l(id="a", price=20.0, lat=13.14, lng=78.13)
    b = _l(id="b", price=20.0, lat=13.14, lng=78.13)
    out = rank_listings(
        [b, a], buyer_lat=13.14, buyer_lng=78.13,
        radius_km=25.0, benchmark_by_crop={"Tomato": 20.0},
    )
    assert [r.listing.id for r in out] == ["a", "b"]
