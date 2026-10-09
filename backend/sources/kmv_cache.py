"""
Persist KMV scraper output into the kmv_price_cache table.

Two entry points:
    refresh_snapshot(db, on_date=today)  — full sweep, meant for cron
    refresh_commodity(db, name, on_date) — narrow refresh for one crop
                                           (used by the API's stale-guard)

Both upsert on the (market, commodity, variety, arrival_date) natural key.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy.orm import Session

import models
from . import kmv

log = logging.getLogger(__name__)


def _upsert_rows(db: Session, rows: Iterable[kmv.KmvRow]) -> int:
    """
    Upsert a batch of KmvRow into the cache table.

    Deduplicates in-memory first — KMV occasionally returns two rows for the
    same (market, commodity, variety, date) tuple (a market reporting under
    two variety codes that both round to the same variety string). Keeping
    only the last occurrence prevents UNIQUE-constraint conflicts on insert.
    """
    now = datetime.utcnow()
    by_key: dict = {}
    for r in rows:
        by_key[(r.market, r.commodity, r.variety, r.arrival_date)] = r

    n = 0
    for r in by_key.values():
        existing = (
            db.query(models.KmvPriceCache)
            .filter(
                models.KmvPriceCache.market       == r.market,
                models.KmvPriceCache.commodity    == r.commodity,
                models.KmvPriceCache.variety      == r.variety,
                models.KmvPriceCache.arrival_date == r.arrival_date,
            )
            .one_or_none()
        )
        if existing is None:
            db.add(models.KmvPriceCache(
                market         = r.market,
                commodity      = r.commodity,
                variety        = r.variety,
                arrival_date   = r.arrival_date,
                arrivals_qtl   = Decimal(str(r.arrivals_qtl)) if r.arrivals_qtl is not None else None,
                min_price_kg   = Decimal(str(r.min_kg())),
                max_price_kg   = Decimal(str(r.max_kg())),
                modal_price_kg = Decimal(str(r.modal_kg())),
                fetched_at     = now,
            ))
        else:
            existing.arrivals_qtl   = Decimal(str(r.arrivals_qtl)) if r.arrivals_qtl is not None else None
            existing.min_price_kg   = Decimal(str(r.min_kg()))
            existing.max_price_kg   = Decimal(str(r.max_kg()))
            existing.modal_price_kg = Decimal(str(r.modal_kg()))
            existing.fetched_at     = now
        n += 1
    db.commit()
    return n


def refresh_snapshot(db: Session, on_date: Optional[date] = None) -> int:
    """
    Full KMV sweep. ~127 commodities × 5s throttle ≈ 10 min.

    Commits after each commodity so a mid-sweep failure (network blip,
    parse error, one bad UNIQUE conflict) doesn't roll back the whole
    session — you keep whatever succeeded before the failure point.
    """
    on_date = on_date or date.today()
    total = 0
    fails = 0
    for cc in kmv.discover_commodities():
        try:
            rows = kmv.fetch_prices_for(cc, on_date)
            n = _upsert_rows(db, rows)
            total += n
        except Exception as e:
            db.rollback()
            fails += 1
            log.warning("[kmv-cache] %s/%s failed: %s", cc.comm_name, cc.var_name, e)
    log.info("[kmv-cache] snapshot %s → %d rows upserted (%d commodities failed)",
             on_date.isoformat(), total, fails)
    return total


def refresh_commodity(db: Session, comm_name: str, on_date: Optional[date] = None) -> int:
    """
    Narrow refresh — fetch one commodity's report. Used by the API's
    stale-guard: if a farmer searches Tomato and the cache is >6h old,
    kick this off in the background so the next request has fresh data.
    """
    on_date = on_date or date.today()
    target = comm_name.strip().lower()
    for cc in kmv.discover_commodities():
        if cc.comm_name.strip().lower() == target:
            rows = kmv.fetch_prices_for(cc, on_date)
            n = _upsert_rows(db, rows)
            log.info("[kmv-cache] %s %s → %d rows upserted",
                     cc.comm_name, on_date.isoformat(), n)
            return n
    log.warning("[kmv-cache] commodity %r not found in KMV catalogue", comm_name)
    return 0


def seed_cache_if_empty(db: Session) -> int:
    """
    If kmv_price_cache table is empty (e.g. freshly created production database
    on Render where scraping the live portal from cloud data centers times out),
    seed it from the packaged baseline snapshot in backend/data/kmv_seed.json.
    """
    if db.query(models.KmvPriceCache.id).first() is not None:
        return 0

    import json
    import uuid
    from pathlib import Path
    seed_file = Path(__file__).resolve().parent.parent / "data" / "kmv_seed.json"
    if not seed_file.exists():
        log.warning("[kmv-cache] Seed file %s not found", seed_file)
        return 0

    try:
        with open(seed_file, "r", encoding="utf-8") as f:
            records = json.load(f)
        objects = []
        now = datetime.utcnow()
        for r in records:
            arr_d = datetime.strptime(r["arrival_date"], "%Y-%m-%d").date()
            objects.append(models.KmvPriceCache(
                id             = str(uuid.uuid4()),
                market         = r["market"],
                commodity      = r["commodity"],
                variety        = r.get("variety"),
                arrival_date   = arr_d,
                arrivals_qtl   = Decimal(str(r["arrivals_qtl"])) if r.get("arrivals_qtl") is not None else None,
                min_price_kg   = Decimal(str(r["min_price_kg"])),
                max_price_kg   = Decimal(str(r["max_price_kg"])),
                modal_price_kg = Decimal(str(r["modal_price_kg"])),
                fetched_at     = now,
            ))
        db.bulk_save_objects(objects)
        db.commit()
        log.info("[kmv-cache] Seeded %d KMV price rows into kmv_price_cache from %s", len(objects), seed_file.name)
        return len(objects)
    except Exception as e:
        db.rollback()
        log.error("[kmv-cache] Failed seeding kmv_price_cache: %s", e)
        return 0
