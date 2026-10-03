"""
Farm Business Overview / Generational BI endpoints.

Thin FastAPI wrappers around bi.calculations. All aggregation math lives
in the pure functions there; this file just hydrates ORM rows into
CycleSnapshots, calls the pure functions, and returns JSON.

Auth model: every endpoint requires the current farmer. Plots and cycles
are visible to whoever CURRENTLY owns the plot (not who logged them
originally — that supports generational transfer).
"""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import date, datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import database
import models
from bi.calculations import (
    CycleSnapshot,
    compute_roi,
    rank_recommendations,
    year_over_year_series,
)
from dependencies import get_current_farmer

router = APIRouter(prefix="/api/v1/bi", tags=["business-intelligence"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class PlotIn(BaseModel):
    label:     str = Field(..., min_length=1, max_length=64)
    label_kn:  Optional[str] = None
    area_ha:   float = Field(..., ge=0)
    latitude:  Optional[float] = None
    longitude: Optional[float] = None
    soil_type: Optional[str]   = None


class PlotOut(BaseModel):
    id:                 str
    label:              str
    label_kn:           Optional[str]
    area_ha:            float
    latitude:           Optional[float]
    longitude:          Optional[float]
    soil_type:          Optional[str]
    created_at:         datetime
    active_cycle:       Optional["CycleOut"] = None
    last_completed_roi: Optional[float]      = None
    cycles_count:       int                  = 0


class CycleIn(BaseModel):
    crop_name:             str
    crop_name_kn:          Optional[str] = None
    sowing_date:           date
    expected_harvest_date: Optional[date] = None
    notes:                 Optional[str]  = None


class CycleUpdate(BaseModel):
    crop_name:             Optional[str]  = None
    crop_name_kn:          Optional[str]  = None
    sowing_date:           Optional[date] = None
    expected_harvest_date: Optional[date] = None
    notes:                 Optional[str]  = None
    status:                Optional[Literal["PLANNED", "GROWING", "HARVESTED", "ABANDONED"]] = None


class CycleOut(BaseModel):
    id:                    str
    plot_id:               str
    plot_label:            Optional[str] = None
    crop_name:             str
    crop_name_kn:          Optional[str]
    sowing_date:           date
    expected_harvest_date: Optional[date]
    actual_harvest_date:   Optional[date]
    status:                str
    total_revenue:         float
    total_expenses:        float
    net_profit:            Optional[float]
    roi_percent:           Optional[float]
    notes:                 Optional[str]
    logged_by_farmer_id:   str


PlotOut.model_rebuild()


class EntryIn(BaseModel):
    kind:        Literal["INCOME", "EXPENSE"]
    amount:      float = Field(..., gt=0)
    subcategory: str   = Field(..., min_length=1, max_length=32)
    note:        Optional[str] = None


class TransferInit(BaseModel):
    reason: Literal["INHERITANCE", "SALE"] = "INHERITANCE"


class TransferAccept(BaseModel):
    claim_code: str = Field(..., min_length=6, max_length=6)


# ── Helpers ─────────────────────────────────────────────────────────────────

# Short-lived in-memory claim-code store. Fine for dev / single-instance
# deployment. When we grow to multiple backend workers, this moves to Redis
# or a claim_codes DB table with a TTL column.
_CLAIM_CODES: dict[str, dict] = {}
_CLAIM_TTL_SECONDS = 15 * 60


def _generate_claim_code() -> str:
    """6 uppercase alphanumerics, unambiguous (no 0/O/1/I)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def _require_owned_plot(plot_id: str, farmer_id: str, db: Session) -> models.Plot:
    plot = db.get(models.Plot, plot_id)
    if plot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plot not found")
    if str(plot.current_farmer_id) != farmer_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not own this plot")
    return plot


def _cycle_to_snapshot(row: models.CropCycle) -> CycleSnapshot:
    """Hydrate an ORM row into the pure-function-friendly dataclass."""
    return CycleSnapshot(
        plot_id        = str(row.plot_id),
        crop_name      = row.crop_name,
        crop_name_kn   = row.crop_name_kn,
        sowing_date    = row.sowing_date,
        harvest_date   = row.actual_harvest_date,
        status         = row.status.value if hasattr(row.status, "value") else str(row.status),
        total_revenue  = float(row.total_revenue or 0),
        total_expenses = float(row.total_expenses or 0),
        roi_percent    = float(row.roi_percent) if row.roi_percent is not None else None,
    )


def _cycle_to_out(row: models.CropCycle, plot_label: Optional[str] = None) -> CycleOut:
    return CycleOut(
        id                    = str(row.id),
        plot_id               = str(row.plot_id),
        plot_label            = plot_label,
        crop_name             = row.crop_name,
        crop_name_kn          = row.crop_name_kn,
        sowing_date           = row.sowing_date,
        expected_harvest_date = row.expected_harvest_date,
        actual_harvest_date   = row.actual_harvest_date,
        status                = row.status.value if hasattr(row.status, "value") else str(row.status),
        total_revenue         = float(row.total_revenue or 0),
        total_expenses        = float(row.total_expenses or 0),
        net_profit            = float(row.net_profit)  if row.net_profit  is not None else None,
        roi_percent           = float(row.roi_percent) if row.roi_percent is not None else None,
        notes                 = row.notes,
        logged_by_farmer_id   = str(row.logged_by_farmer_id),
    )


def _refresh_cycle_totals(cycle: models.CropCycle, db: Session) -> None:
    """
    Recompute total_revenue and total_expenses from linked farm_ledger rows.
    Called after every add-entry and after mark-harvested. ROI is only set
    once status becomes HARVESTED — until then leaving net_profit/roi None
    is honest ("we don't know yet").
    """
    entries = db.query(models.FarmLedger).filter_by(cycle_id=cycle.id).all()
    revenue = sum(float(e.amount) for e in entries if e.transaction_type == models.TransactionType.INCOME)
    expenses = sum(float(e.amount) for e in entries if e.transaction_type == models.TransactionType.EXPENSE)
    cycle.total_revenue = revenue
    cycle.total_expenses = expenses
    if cycle.status == models.CycleStatus.HARVESTED:
        net, roi = compute_roi(revenue, expenses)
        cycle.net_profit = net
        cycle.roi_percent = roi
    else:
        # Not harvested yet: expose running totals but no ROI (spec: never
        # display a shaky mid-season ROI as if it were final).
        cycle.net_profit = None
        cycle.roi_percent = None


# ── Home stats (drives the "2 ha · 0 crops · 0 cattle" chips) ──────────────

@router.get("/home-stats")
def home_stats(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Aggregate stats the Home page displays as tappable chips.

    plots_count      - Plot rows this farmer currently owns
    cycles_count     - CropCycle rows across those plots (any status)
    crop_types_count - DISTINCT crop_name across those cycles

    "crop_types_count" is the reason this exists: instead of asking farmers
    to declare crops at signup, we derive the number from what they've
    actually logged as cycles in the Business (Ledger) tab. Zero at signup,
    grows organically as they log real seasons.
    """
    plot_ids = [
        str(row.id)
        for row in db.query(models.Plot).filter_by(current_farmer_id=str(farmer.id)).all()
    ]
    if not plot_ids:
        return {
            "plots_count":      0,
            "cycles_count":     0,
            "crop_types_count": 0,
            "crop_types":       [],
        }
    cycles = (
        db.query(models.CropCycle)
        .filter(models.CropCycle.plot_id.in_(plot_ids))
        .all()
    )
    crop_types = sorted({c.crop_name for c in cycles})
    return {
        "plots_count":      len(plot_ids),
        "cycles_count":     len(cycles),
        "crop_types_count": len(crop_types),
        "crop_types":       crop_types,
    }


# ── Plots ───────────────────────────────────────────────────────────────────

@router.get("/plots", response_model=List[PlotOut])
def list_plots(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plots = db.query(models.Plot).filter_by(current_farmer_id=str(farmer.id)).all()
    out = []
    for p in plots:
        cycles = db.query(models.CropCycle).filter_by(plot_id=p.id).all()
        active = next((c for c in cycles if c.status.value in ("PLANNED", "GROWING")), None)
        harvested = [c for c in cycles if c.status == models.CycleStatus.HARVESTED and c.roi_percent is not None]
        # Sort by harvest date DESC, then by updated_at DESC as a tiebreaker.
        # Without the tiebreaker, multiple cycles harvested on the same day
        # would fall back to DB insertion order — so the FIRST-harvested-today
        # cycle would win instead of the most recent one the farmer marked.
        harvested.sort(
            key=lambda c: (
                c.actual_harvest_date or date.min,
                c.updated_at or datetime.min,
            ),
            reverse=True,
        )
        last_roi = float(harvested[0].roi_percent) if harvested else None

        out.append(PlotOut(
            id                 = str(p.id),
            label              = p.label,
            label_kn           = p.label_kn,
            area_ha            = float(p.area_ha),
            latitude           = float(p.latitude)  if p.latitude  is not None else None,
            longitude          = float(p.longitude) if p.longitude is not None else None,
            soil_type          = p.soil_type,
            created_at         = p.created_at,
            active_cycle       = _cycle_to_out(active, p.label) if active else None,
            last_completed_roi = last_roi,
            cycles_count       = len(cycles),
        ))
    return out


@router.post("/plots", response_model=PlotOut, status_code=status.HTTP_201_CREATED)
def create_plot(
    body: PlotIn,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plot = models.Plot(
        id                = str(uuid.uuid4()),
        current_farmer_id = str(farmer.id),
        label             = body.label,
        label_kn          = body.label_kn,
        area_ha           = body.area_ha,
        latitude          = body.latitude,
        longitude         = body.longitude,
        soil_type         = body.soil_type,
    )
    db.add(plot)
    db.add(models.PlotOwnershipHistory(
        id        = str(uuid.uuid4()),
        plot_id   = plot.id,
        farmer_id = str(farmer.id),
        reason    = models.TransferReason.INITIAL,
    ))
    db.commit()
    db.refresh(plot)
    return PlotOut(
        id=str(plot.id), label=plot.label, label_kn=plot.label_kn,
        area_ha=float(plot.area_ha),
        latitude=float(plot.latitude) if plot.latitude is not None else None,
        longitude=float(plot.longitude) if plot.longitude is not None else None,
        soil_type=plot.soil_type, created_at=plot.created_at,
        active_cycle=None, last_completed_roi=None, cycles_count=0,
    )


@router.delete("/plots/{plot_id}")
def delete_plot(
    plot_id: str,
    confirm: Optional[str] = Query(None, description="Must equal 'DELETE' when plot has cycles"),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Delete a plot. Data-loss safety:
      - Empty plot (0 cycles) → allowed straight away
      - Plot with cycles      → requires ?confirm=DELETE so the frontend
                                MUST have shown a "type DELETE to confirm"
                                dialog. Prevents accidental loss of a
                                farmer's multi-season history.

    Also removes: ownership history rows, all cycles for the plot, and
    any farm_ledger entries linked to those cycles (cycle_id set NULL on
    survivors is not what we want — a deleted plot's cycles should not
    keep dangling ledger entries).
    """
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    cycles = db.query(models.CropCycle).filter_by(plot_id=plot.id).all()

    if cycles and confirm != "DELETE":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "error":         "confirmation_required",
                "cycles_count":  len(cycles),
                "message":       "This plot has cycle history. Pass confirm=DELETE to proceed.",
            },
        )

    cycle_ids = [c.id for c in cycles]
    if cycle_ids:
        db.query(models.FarmLedger).filter(models.FarmLedger.cycle_id.in_(cycle_ids)).delete(synchronize_session=False)
        db.query(models.CropCycle).filter(models.CropCycle.plot_id == plot.id).delete(synchronize_session=False)
    db.query(models.PlotOwnershipHistory).filter_by(plot_id=plot.id).delete(synchronize_session=False)
    db.delete(plot)
    db.commit()
    return {"status": "deleted", "plot_id": plot_id, "cycles_removed": len(cycles)}


@router.patch("/plots/{plot_id}", response_model=PlotOut)
def update_plot(
    plot_id: str,
    body: PlotIn,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    plot.label    = body.label
    plot.label_kn = body.label_kn
    plot.area_ha  = body.area_ha
    plot.latitude  = body.latitude
    plot.longitude = body.longitude
    plot.soil_type = body.soil_type
    db.commit()
    db.refresh(plot)
    cycles = db.query(models.CropCycle).filter_by(plot_id=plot.id).all()
    return PlotOut(
        id=str(plot.id), label=plot.label, label_kn=plot.label_kn,
        area_ha=float(plot.area_ha),
        latitude=float(plot.latitude) if plot.latitude is not None else None,
        longitude=float(plot.longitude) if plot.longitude is not None else None,
        soil_type=plot.soil_type, created_at=plot.created_at,
        active_cycle=None, last_completed_roi=None, cycles_count=len(cycles),
    )


# ── Cycles ──────────────────────────────────────────────────────────────────

@router.get("/plots/{plot_id}/cycles", response_model=List[CycleOut])
def list_cycles(
    plot_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    cycles = (
        db.query(models.CropCycle)
        .filter_by(plot_id=plot.id)
        .order_by(models.CropCycle.sowing_date.desc())
        .all()
    )
    return [_cycle_to_out(c, plot.label) for c in cycles]


@router.post("/plots/{plot_id}/cycles", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
def create_cycle(
    plot_id: str,
    body: CycleIn,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    cycle = models.CropCycle(
        id                    = str(uuid.uuid4()),
        plot_id               = plot.id,
        logged_by_farmer_id   = str(farmer.id),
        crop_name             = body.crop_name,
        crop_name_kn          = body.crop_name_kn,
        sowing_date           = body.sowing_date,
        expected_harvest_date = body.expected_harvest_date,
        status                = models.CycleStatus.GROWING,
        notes                 = body.notes,
    )
    db.add(cycle)
    db.commit()
    db.refresh(cycle)
    return _cycle_to_out(cycle, plot.label)


@router.patch("/cycles/{cycle_id}", response_model=CycleOut)
def update_cycle(
    cycle_id: str,
    body: CycleUpdate,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    cycle = db.get(models.CropCycle, cycle_id)
    if cycle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    plot = _require_owned_plot(str(cycle.plot_id), str(farmer.id), db)
    if body.crop_name             is not None: cycle.crop_name             = body.crop_name
    if body.crop_name_kn          is not None: cycle.crop_name_kn          = body.crop_name_kn
    if body.sowing_date           is not None: cycle.sowing_date           = body.sowing_date
    if body.expected_harvest_date is not None: cycle.expected_harvest_date = body.expected_harvest_date
    if body.notes                 is not None: cycle.notes                 = body.notes
    if body.status                is not None:
        cycle.status = models.CycleStatus(body.status)
        if cycle.status == models.CycleStatus.HARVESTED and cycle.actual_harvest_date is None:
            cycle.actual_harvest_date = date.today()
        _refresh_cycle_totals(cycle, db)
    db.commit()
    db.refresh(cycle)
    return _cycle_to_out(cycle, plot.label)


@router.post("/cycles/{cycle_id}/entries", response_model=CycleOut, status_code=status.HTTP_201_CREATED)
def add_entry(
    cycle_id: str,
    body: EntryIn,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Add an expense or income entry tied to a cycle. Writes to farm_ledger
    with cycle_id set (so the entry is BOTH visible on the general ledger
    AND counted in this cycle's totals). Refreshes cached totals.
    """
    cycle = db.get(models.CropCycle, cycle_id)
    if cycle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    plot = _require_owned_plot(str(cycle.plot_id), str(farmer.id), db)

    entry = models.FarmLedger(
        id               = str(uuid.uuid4()),
        farmer_id        = str(farmer.id),
        transaction_type = (models.TransactionType.INCOME
                            if body.kind == "INCOME"
                            else models.TransactionType.EXPENSE),
        amount           = body.amount,
        category         = body.subcategory,   # human-readable; same as subcategory here
        timestamp        = datetime.utcnow(),
        cycle_id         = cycle.id,
        subcategory      = body.subcategory,
    )
    db.add(entry)
    db.flush()
    _refresh_cycle_totals(cycle, db)
    db.commit()
    db.refresh(cycle)
    return _cycle_to_out(cycle, plot.label)


@router.post("/cycles/{cycle_id}/harvest", response_model=CycleOut)
def mark_harvested(
    cycle_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    cycle = db.get(models.CropCycle, cycle_id)
    if cycle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cycle not found")
    plot = _require_owned_plot(str(cycle.plot_id), str(farmer.id), db)
    cycle.status = models.CycleStatus.HARVESTED
    cycle.actual_harvest_date = date.today()
    _refresh_cycle_totals(cycle, db)
    db.commit()
    db.refresh(cycle)
    return _cycle_to_out(cycle, plot.label)


# ── Analytics ───────────────────────────────────────────────────────────────

@router.get("/plots/{plot_id}/recommendations")
def get_recommendations(
    plot_id: str,
    month: int = Query(..., ge=1, le=12),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Ranked "what should I plant this month?" list based on the farmer's OWN
    past cycles on THIS plot. Includes generational history — cycles logged
    by previous owners are considered too, since the land itself carries
    the agronomic signal.
    """
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    cycles = db.query(models.CropCycle).filter_by(plot_id=plot.id).all()
    snapshots = [_cycle_to_snapshot(c) for c in cycles]
    return rank_recommendations(plot_id=str(plot.id), target_month=month, cycles=snapshots)


@router.get("/plots/{plot_id}/history/{crop_name}")
def get_yoy_history(
    plot_id: str,
    crop_name: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    cycles = db.query(models.CropCycle).filter_by(plot_id=plot.id).all()
    snapshots = [_cycle_to_snapshot(c) for c in cycles]
    series = year_over_year_series(str(plot.id), crop_name, snapshots)
    return [
        {
            "year":              p.year,
            "roi_percent":       p.roi_percent,
            "net_profit":        p.net_profit,
            "avg_temp_c":        p.avg_temp_c,
            "total_rainfall_mm": p.total_rainfall_mm,
        }
        for p in series
    ]


@router.get("/plots/{plot_id}/summary")
def plot_summary(
    plot_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Overview card data. Honest empty state: if no HARVESTED cycles exist, all
    "best crop"/ROI fields come back null (frontend renders "not enough data
    yet" instead of a fake number).
    """
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    cycles = db.query(models.CropCycle).filter_by(plot_id=plot.id).all()
    harvested = [c for c in cycles if c.status == models.CycleStatus.HARVESTED and c.roi_percent is not None]

    current_year = date.today().year
    this_year_profit = sum(
        float(c.net_profit or 0) for c in harvested
        if c.actual_harvest_date and c.actual_harvest_date.year == current_year
    )
    best = max(harvested, key=lambda c: float(c.roi_percent), default=None)
    worst = min(harvested, key=lambda c: float(c.roi_percent), default=None)

    return {
        "plot_id":               str(plot.id),
        "plot_label":            plot.label,
        "plot_label_kn":         plot.label_kn,
        "area_ha":               float(plot.area_ha),
        "total_cycles":          len(cycles),
        "harvested_cycles":      len(harvested),
        "current_year":          current_year,
        "current_year_profit":   round(this_year_profit, 2),
        "best_crop": None if best is None else {
            "crop_name":    best.crop_name,
            "crop_name_kn": best.crop_name_kn,
            "roi_percent":  float(best.roi_percent),
            "year":         best.actual_harvest_date.year if best.actual_harvest_date else None,
        },
        "worst_crop": None if worst is None or worst.id == (best.id if best else None) else {
            "crop_name":    worst.crop_name,
            "crop_name_kn": worst.crop_name_kn,
            "roi_percent":  float(worst.roi_percent),
            "year":         worst.actual_harvest_date.year if worst.actual_harvest_date else None,
        },
    }


# ── Ownership transfer (generational handover) ──────────────────────────────

@router.post("/plots/{plot_id}/transfer/init")
def transfer_init(
    plot_id: str,
    body: TransferInit,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Current owner generates a 6-character claim code. Anyone logged in to
    a KisanShakti account can accept it within 15 minutes. Code is stored
    in-process only; a server restart invalidates outstanding codes (which
    is fine — the farmer just generates a new one).
    """
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    # Purge expired codes so the map doesn't grow unbounded
    now = datetime.utcnow()
    expired = [k for k, v in _CLAIM_CODES.items() if v["expires_at"] < now]
    for k in expired:
        _CLAIM_CODES.pop(k, None)

    code = _generate_claim_code()
    _CLAIM_CODES[code] = {
        "plot_id":    str(plot.id),
        "from_farmer_id": str(farmer.id),
        "reason":     body.reason,
        "expires_at": now + timedelta(seconds=_CLAIM_TTL_SECONDS),
    }
    return {
        "claim_code":        code,
        "expires_in_seconds": _CLAIM_TTL_SECONDS,
        "plot_label":        plot.label,
    }


@router.post("/plots/transfer/accept")
def transfer_accept(
    body: TransferAccept,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """
    Receiving farmer types the code. On success the plot's current_farmer_id
    flips to them and a PlotOwnershipHistory row records the handover.
    All crop_cycles stay attached to plot_id, so the new owner inherits full
    history immediately — that IS the generational feature.
    """
    entry = _CLAIM_CODES.get(body.claim_code.upper())
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid or expired claim code")
    if entry["expires_at"] < datetime.utcnow():
        _CLAIM_CODES.pop(body.claim_code.upper(), None)
        raise HTTPException(status.HTTP_410_GONE, "Claim code expired")
    if entry["from_farmer_id"] == str(farmer.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot accept your own transfer")

    plot = db.get(models.Plot, entry["plot_id"])
    if plot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plot no longer exists")

    previous_owner_id = str(plot.current_farmer_id)
    plot.current_farmer_id = str(farmer.id)
    db.add(models.PlotOwnershipHistory(
        id               = str(uuid.uuid4()),
        plot_id          = plot.id,
        farmer_id        = str(farmer.id),
        transferred_from = previous_owner_id,
        reason           = models.TransferReason(entry["reason"]),
    ))
    db.commit()
    _CLAIM_CODES.pop(body.claim_code.upper(), None)
    return {"status": "ok", "plot_id": str(plot.id), "plot_label": plot.label}


@router.get("/plots/{plot_id}/ownership-history")
def ownership_history(
    plot_id: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    plot = _require_owned_plot(plot_id, str(farmer.id), db)
    rows = (
        db.query(models.PlotOwnershipHistory)
        .filter_by(plot_id=plot.id)
        .order_by(models.PlotOwnershipHistory.transferred_at.asc())
        .all()
    )
    return [
        {
            "farmer_id":        str(r.farmer_id),
            "transferred_from": str(r.transferred_from) if r.transferred_from else None,
            "transferred_at":   r.transferred_at,
            "reason":           r.reason.value if hasattr(r.reason, "value") else str(r.reason),
        }
        for r in rows
    ]
