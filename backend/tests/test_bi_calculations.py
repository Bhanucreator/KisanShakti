"""
Unit tests for backend/bi/calculations.py.

Every test hits a specific rule from the spec — check the top comment on
each test to see which one. The spec says:

    Write pytest cases for: normal case, zero-expense cycle (roi = null),
    single-season crop (excluded from recommendations), abandoned cycle
    (excluded from averages), and the insufficient_data path.

...plus a few extra guardrails (variance flag, month tolerance, YoY sort).
"""
from __future__ import annotations

from datetime import date

import pytest

from bi.calculations import (
    CycleSnapshot,
    compute_roi,
    historical_averages,
    rank_recommendations,
    variance_flag,
    year_over_year_series,
)


def _cycle(
    plot="p1", crop="Tomato", crop_kn="ಟೊಮೇಟೊ",
    sowing=date(2024, 5, 1), harvest=date(2024, 8, 1),
    status="HARVESTED", revenue=20000, expenses=10000, roi=100.0,
) -> CycleSnapshot:
    """Test helper: default is a nice harvested tomato cycle at 100% ROI."""
    return CycleSnapshot(
        plot_id=plot, crop_name=crop, crop_name_kn=crop_kn,
        sowing_date=sowing, harvest_date=harvest, status=status,
        total_revenue=revenue, total_expenses=expenses, roi_percent=roi,
    )


# ── compute_roi ─────────────────────────────────────────────────────────────

def test_compute_roi_normal():
    """Normal case from spec."""
    net, roi = compute_roi(15000, 5000)
    assert net == 10000
    assert roi == 200.0


def test_compute_roi_zero_expenses_returns_none():
    """Spec: zero-expense cycle → roi_percent is None (never 0%)."""
    net, roi = compute_roi(5000, 0)
    assert net == 5000
    assert roi is None


def test_compute_roi_loss():
    """Negative profit still gets a real ROI number (a warning to the farmer)."""
    net, roi = compute_roi(3000, 5000)
    assert net == -2000
    assert roi == -40.0


def test_compute_roi_rounds_to_two_decimals():
    net, roi = compute_roi(10000, 3000)
    assert net == 7000.0
    assert roi == 233.33


# ── variance_flag ───────────────────────────────────────────────────────────

def test_variance_flag_flags_wide_spread():
    """avg 100, range 200 (0 to 200) → 200 > 100*0.75 → variable."""
    assert variance_flag(100, 0, 200) is True


def test_variance_flag_ignores_tight_spread():
    """avg 100, range 20 (90 to 110) → 20 < 75 → stable."""
    assert variance_flag(100, 90, 110) is False


def test_variance_flag_guards_zero_or_negative_avg():
    """Avoid flagging a loss-making crop as merely 'variable'."""
    assert variance_flag(0, -50, 50) is False
    assert variance_flag(-20, -100, 10) is False


# ── historical_averages ─────────────────────────────────────────────────────

def test_historical_averages_excludes_abandoned():
    """
    Spec: an ABANDONED cycle isn't a fair data point — must not drag the
    average up or down.
    """
    cycles = [
        _cycle(roi=100),
        _cycle(roi=150),
        _cycle(status="ABANDONED", roi=-90),
    ]
    stats = historical_averages(cycles)
    key = ("p1", "Tomato", 5)
    assert stats[key].seasons_tracked == 2
    assert stats[key].avg_roi == 125.0


def test_historical_averages_excludes_none_roi_cycles():
    """A cycle with roi_percent=None (zero expenses) can't be averaged in."""
    cycles = [
        _cycle(roi=100),
        _cycle(roi=200),
        _cycle(expenses=0, revenue=5000, roi=None),
    ]
    stats = historical_averages(cycles)
    key = ("p1", "Tomato", 5)
    assert stats[key].seasons_tracked == 2


def test_historical_averages_groups_by_sowing_month():
    """
    May tomato and August tomato are DIFFERENT recommendations — same crop,
    different agronomy. Must live in separate buckets.
    """
    cycles = [
        _cycle(sowing=date(2023, 5, 1), roi=100),
        _cycle(sowing=date(2024, 5, 1), roi=200),
        _cycle(sowing=date(2024, 8, 1), harvest=date(2024, 11, 1), roi=50),
    ]
    stats = historical_averages(cycles)
    assert ("p1", "Tomato", 5) in stats
    assert ("p1", "Tomato", 8) in stats
    assert stats[("p1", "Tomato", 5)].seasons_tracked == 2
    assert stats[("p1", "Tomato", 8)].seasons_tracked == 1


# ── rank_recommendations ────────────────────────────────────────────────────

def test_rank_recommendations_single_season_excluded():
    """
    Spec: one lucky season is not a trend. A crop with 1 completed cycle
    must NOT appear in recommendations.
    """
    cycles = [_cycle(crop="Ragi", roi=500)]
    out = rank_recommendations("p1", target_month=5, cycles=cycles)
    assert out["status"] == "insufficient_data"
    assert out["recommendations"] == []


def test_rank_recommendations_sorted_by_avg_roi_descending():
    cycles = [
        # Tomato: two seasons, avg 150
        _cycle(crop="Tomato", roi=100),
        _cycle(crop="Tomato", sowing=date(2025, 5, 5), roi=200),
        # Ragi: two seasons, avg 80
        _cycle(crop="Ragi", crop_kn="ರಾಗಿ", roi=60),
        _cycle(crop="Ragi", crop_kn="ರಾಗಿ", sowing=date(2025, 5, 8), roi=100),
    ]
    out = rank_recommendations("p1", target_month=5, cycles=cycles)
    assert out["status"] == "ok"
    names = [r["crop_name"] for r in out["recommendations"]]
    assert names == ["Tomato", "Ragi"]


def test_rank_recommendations_insufficient_data_returns_flag_not_empty_array():
    """
    Spec: distinguish "no crops qualify" from "endpoint is broken" — must
    return explicit insufficient_data flag, not a bare empty array.
    """
    out = rank_recommendations("p_unknown", target_month=5, cycles=[])
    assert out["status"] == "insufficient_data"
    assert "recommendations" in out
    assert "reason" in out


def test_rank_recommendations_month_tolerance_captures_neighbors():
    """
    ±1 month tolerance: April and June cycles both qualify for a May
    recommendation (sowing dates drift year to year).
    """
    cycles = [
        _cycle(sowing=date(2023, 4, 10), harvest=date(2023, 7, 1), roi=100),
        _cycle(sowing=date(2024, 6, 15), harvest=date(2024, 9, 1), roi=120),
    ]
    out = rank_recommendations("p1", target_month=5, cycles=cycles)
    assert out["status"] == "ok"
    assert out["recommendations"][0]["seasons_tracked"] == 2


def test_rank_recommendations_wrong_plot_excluded():
    """A great tomato season on plot B shouldn't be recommended for plot A."""
    cycles = [
        _cycle(plot="p_other", roi=1000),
        _cycle(plot="p_other", sowing=date(2025, 5, 5), roi=1000),
    ]
    out = rank_recommendations("p1", target_month=5, cycles=cycles)
    assert out["status"] == "insufficient_data"


def test_rank_recommendations_variance_flag_surfaces():
    cycles = [
        _cycle(crop="Chilli", roi=0),
        _cycle(crop="Chilli", sowing=date(2025, 5, 3), roi=200),
    ]
    out = rank_recommendations("p1", target_month=5, cycles=cycles)
    assert out["recommendations"][0]["variable"] is True


# ── year_over_year_series ───────────────────────────────────────────────────

def test_year_over_year_sorted_ascending():
    cycles = [
        _cycle(sowing=date(2024, 5, 1), harvest=date(2024, 8, 1), roi=150),
        _cycle(sowing=date(2022, 5, 1), harvest=date(2022, 8, 1), roi=80),
        _cycle(sowing=date(2023, 5, 1), harvest=date(2023, 8, 1), roi=120),
    ]
    series = year_over_year_series("p1", "Tomato", cycles)
    assert [p.year for p in series] == [2022, 2023, 2024]
    assert [p.roi_percent for p in series] == [80, 120, 150]


def test_year_over_year_weather_overlay_optional():
    """Weather lookup absent → temp/rainfall are None but series still emits."""
    cycles = [_cycle(harvest=date(2024, 8, 1))]
    series = year_over_year_series("p1", "Tomato", cycles)
    assert series[0].avg_temp_c is None
    assert series[0].total_rainfall_mm is None


def test_year_over_year_excludes_in_flight_cycles():
    """A cycle still GROWING isn't a historical data point."""
    cycles = [
        _cycle(harvest=date(2024, 8, 1)),
        _cycle(status="GROWING", harvest=None),
    ]
    series = year_over_year_series("p1", "Tomato", cycles)
    assert len(series) == 1


def test_year_over_year_no_fabrication_when_empty():
    """
    Spec: never invent a data point to fill a gap. Empty history → empty list,
    not an interpolated year-shaped hole.
    """
    series = year_over_year_series("p1", "Tomato", [])
    assert series == []
