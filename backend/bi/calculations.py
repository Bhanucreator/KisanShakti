"""
Pure functions for Farm Business Overview / Generational BI.

Every function here takes plain dicts / dataclasses and returns plain dicts /
dataclasses. No DB session, no HTTP, no I/O — trivially unit-testable in
isolation. The endpoint layer in bi_endpoints.py hydrates ORM rows into
these dicts before calling.

Golden rules (from the spec):
  - Never fabricate a data point. Every number surfaced must trace to a
    real logged cycle.
  - A single season is not a trend: exclude crops with <2 completed cycles
    from recommendations.
  - Exclude ABANDONED cycles from all averages.
  - When expenses=0, roi_percent is None — do NOT display 0%.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from statistics import mean
from typing import Iterable, Optional


# ── Data shapes ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CycleSnapshot:
    """The minimal projection of a crop_cycles row that BI needs."""
    plot_id:        str
    crop_name:      str
    crop_name_kn:   Optional[str]
    sowing_date:    date
    harvest_date:   Optional[date]
    status:         str                      # PLANNED | GROWING | HARVESTED | ABANDONED
    total_revenue:  float
    total_expenses: float
    roi_percent:    Optional[float]          # cached; may be None


@dataclass(frozen=True)
class GroupStat:
    crop_name:       str
    crop_name_kn:    Optional[str]
    seasons_tracked: int
    avg_roi:         float
    min_roi:         float
    max_roi:         float
    variable:        bool                    # true when range > avg*0.75


@dataclass(frozen=True)
class YearPoint:
    year:              int
    roi_percent:       Optional[float]
    net_profit:        float
    avg_temp_c:        Optional[float] = None
    total_rainfall_mm: Optional[float] = None


# ── 1. Net profit & ROI ─────────────────────────────────────────────────────

def compute_roi(total_revenue: float, total_expenses: float) -> tuple[float, Optional[float]]:
    """
    Returns (net_profit, roi_percent).

    roi_percent is None when total_expenses == 0 (avoid divide-by-zero, and
    do NOT show 0% — that would mislead the farmer).

    Both values rounded to 2 decimals.
    """
    net_profit = round(total_revenue - total_expenses, 2)
    if total_expenses == 0:
        return net_profit, None
    roi_percent = round((net_profit / total_expenses) * 100, 2)
    return net_profit, roi_percent


# ── 2. Historical average ROI (per plot + crop + planting month) ────────────

def historical_averages(
    cycles: Iterable[CycleSnapshot],
) -> dict[tuple[str, str, int], GroupStat]:
    """
    Group HARVESTED, non-abandoned cycles by (plot_id, crop_name, sowing_month)
    and compute avg/min/max ROI per group.

    Groups where seasons_tracked < 2 are STILL returned here (so callers can
    show "1 season tracked" hints) — the ranking function is what filters
    them out from actual recommendations.

    Cycles with roi_percent = None are skipped in the average — a
    zero-expense cycle can't contribute a meaningful ROI number.
    """
    buckets: dict[tuple[str, str, int], list[CycleSnapshot]] = {}
    for c in cycles:
        if c.status == "ABANDONED":
            continue                              # spec: exclude failed cycles
        if c.status != "HARVESTED":
            continue                              # only completed cycles average
        if c.roi_percent is None:
            continue                              # can't average an undefined ROI
        key = (c.plot_id, c.crop_name, c.sowing_date.month)
        buckets.setdefault(key, []).append(c)

    out: dict[tuple[str, str, int], GroupStat] = {}
    for key, group in buckets.items():
        rois = [c.roi_percent for c in group if c.roi_percent is not None]
        avg = round(mean(rois), 2)
        lo  = round(min(rois), 2)
        hi  = round(max(rois), 2)
        roi_range = hi - lo
        # Consistency flag: wide spread relative to average = "variable"
        # (see variance_flag() for the exact rule)
        is_variable = variance_flag(avg, lo, hi)
        out[key] = GroupStat(
            crop_name       = group[0].crop_name,
            crop_name_kn    = group[0].crop_name_kn,
            seasons_tracked = len(group),
            avg_roi         = avg,
            min_roi         = lo,
            max_roi         = hi,
            variable        = is_variable,
        )
    return out


# ── 5. Variance flag ────────────────────────────────────────────────────────

def variance_flag(avg_roi: float, min_roi: float, max_roi: float) -> bool:
    """
    True when the spread is wide relative to the average, per spec:
        roi_range > avg_roi * 0.75

    A crop that averaged 100% ROI but swung between -50% and +250% is very
    different from one that steadily returned 90%-110%. We flag the risky
    one so the farmer sees "high average but variable" instead of trusting
    a shaky number.

    Guard: negative or zero avg_roi → return False (the multiplier check
    isn't meaningful; don't flag a bad crop as "variable" too).
    """
    if avg_roi <= 0:
        return False
    return (max_roi - min_roi) > (avg_roi * 0.75)


# ── 3. Ranking algorithm ────────────────────────────────────────────────────

def rank_recommendations(
    plot_id:         str,
    target_month:    int,
    cycles:          Iterable[CycleSnapshot],
    tolerance_months: int = 1,
) -> dict:
    """
    Ranked crop recommendations for planting on plot_id in target_month.

    Steps:
      1. Compute all historical group stats for this plot
      2. Include groups whose sowing month is within ±tolerance of target
         (sowing dates drift year to year — May planting may become April
         one year, June the next)
      3. Filter groups with seasons_tracked >= 2 (spec: never recommend on 1
         data point — that's not a trend)
      4. Sort descending by avg_roi
      5. Return {"status": "ok", "recommendations": [...]} OR
                {"status": "insufficient_data", "recommendations": [],
                 "reason": "..." } so the frontend can distinguish "no crops
                 qualify" from "the endpoint is broken".

    tolerance_months of ±1 is deliberate: over-narrow = few matches, over-wide
    = a January crop bleeds into an April recommendation which is agronomically
    wrong.
    """
    if not (1 <= target_month <= 12):
        raise ValueError(f"target_month must be 1-12, got {target_month}")

    # Which sowing months qualify (with wrap-around across year boundary)
    tolerated_months = {
        ((target_month - 1 + offset) % 12) + 1
        for offset in range(-tolerance_months, tolerance_months + 1)
    }

    # Aggregate across the tolerance window: April 2023 + June 2024 tomato
    # should count as 2 seasons of "roughly May tomato", not as 1+1 in
    # separate month buckets. Spec: "sowing dates drift year to year".
    per_crop: dict[str, list[CycleSnapshot]] = {}
    for c in cycles:
        if c.plot_id != plot_id:                  continue
        if c.status != "HARVESTED":               continue
        if c.status == "ABANDONED":               continue
        if c.roi_percent is None:                 continue      # zero-expense skip
        if c.sowing_date.month not in tolerated_months: continue
        per_crop.setdefault(c.crop_name, []).append(c)

    stats: list[GroupStat] = []
    for crop_name, group in per_crop.items():
        rois = [c.roi_percent for c in group if c.roi_percent is not None]
        avg = round(mean(rois), 2)
        lo  = round(min(rois), 2)
        hi  = round(max(rois), 2)
        stats.append(GroupStat(
            crop_name       = crop_name,
            crop_name_kn    = group[0].crop_name_kn,
            seasons_tracked = len(group),
            avg_roi         = avg,
            min_roi         = lo,
            max_roi         = hi,
            variable        = variance_flag(avg, lo, hi),
        ))

    ranked = [g for g in stats if g.seasons_tracked >= 2]
    ranked.sort(key=lambda g: g.avg_roi, reverse=True)

    if not ranked:
        # Count what DID show up so the empty state can say something useful
        near_hits = len(stats)
        return {
            "status": "insufficient_data",
            "recommendations": [],
            "reason": (
                "Keep logging — recommendations unlock after 2 completed seasons of the same crop"
            ),
            "near_hits": near_hits,          # crops with 1 season for this month
        }

    return {
        "status": "ok",
        "recommendations": [
            {
                "crop_name":       g.crop_name,
                "crop_name_kn":    g.crop_name_kn,
                "avg_roi":         g.avg_roi,
                "min_roi":         g.min_roi,
                "max_roi":         g.max_roi,
                "seasons_tracked": g.seasons_tracked,
                "variable":        g.variable,
            }
            for g in ranked
        ],
    }


# ── 4. Year-over-year trend series ──────────────────────────────────────────

def year_over_year_series(
    plot_id:        str,
    crop_name:      str,
    cycles:         Iterable[CycleSnapshot],
    weather_lookup: Optional[dict[int, tuple[Optional[float], Optional[float]]]] = None,
) -> list[YearPoint]:
    """
    One data point per year for the plot+crop combo. Straight time series —
    no smoothing, no averaging within a year (spec: "the frontend plots each
    year as its own point so the farmer sees the actual trend line").

    Multiple cycles in the same year (rare but possible — short-season crop
    grown twice) get one point per cycle, so a two-crop year shows as two
    points on that year mark.

    weather_lookup: {year: (avg_temp_c, total_rainfall_mm)} — pass None until
    the weather-history feature is built. The point is emitted anyway with
    the weather fields left as None.
    """
    weather_lookup = weather_lookup or {}
    points: list[YearPoint] = []
    for c in cycles:
        if c.plot_id != plot_id:                 continue
        if c.crop_name != crop_name:             continue
        if c.status != "HARVESTED":              continue      # exclude in-flight
        if c.status == "ABANDONED":              continue      # exclude failures
        if c.harvest_date is None:               continue      # can't place on axis
        year = c.harvest_date.year
        net_profit, _ = compute_roi(c.total_revenue, c.total_expenses)
        temp, rain = weather_lookup.get(year, (None, None))
        points.append(YearPoint(
            year              = year,
            roi_percent       = c.roi_percent,
            net_profit        = net_profit,
            avg_temp_c        = temp,
            total_rainfall_mm = rain,
        ))
    points.sort(key=lambda p: p.year)
    return points
