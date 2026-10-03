"""
Tiny background scheduler.

Two jobs:
  1. KMV price refresher — twice daily at 05:00 IST and 20:00 IST, plus a
     cold-start sweep if the cache is stale on boot.
  2. Listing-expiry sweeper — hourly. Flips AVAILABLE listings past their
     `expires_at` to EXPIRED, cancels any PENDING offers on them, and
     writes notification rows for both the farmer (their listing expired
     unsold) and any affected buyers (their offer is now void).

Uses a plain threading.Thread + time.sleep loop (no apscheduler dep — a
handful of recurring jobs doesn't justify a new library).
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger(__name__)

_started = False
_stop_evt = threading.Event()
IST = timezone(timedelta(hours=5, minutes=30))


def _next_slot(now_ist: datetime) -> datetime:
    """Return the next scheduled run in IST — either today 05:00 / today 20:00 / tomorrow 05:00."""
    slots = [
        now_ist.replace(hour=5,  minute=0, second=0, microsecond=0),
        now_ist.replace(hour=20, minute=0, second=0, microsecond=0),
    ]
    for s in slots:
        if s > now_ist:
            return s
    return slots[0] + timedelta(days=1)


def _run_snapshot() -> None:
    """One full KMV sweep. Wrapped in a fresh DB session; swallows all errors."""
    try:
        import database  # local import — avoids circular startup deps
        from sources import kmv_cache
        db = database.SessionLocal()
        try:
            n = kmv_cache.refresh_snapshot(db)
            log.info("[scheduler] kmv snapshot done: %d rows", n)
        finally:
            db.close()
    except Exception as e:
        log.exception("[scheduler] kmv snapshot failed: %s", e)


def _cold_start_check() -> bool:
    """True if today's KMV cache is empty or stalest row is > 12h old."""
    try:
        import database
        import models
        db = database.SessionLocal()
        try:
            latest = (
                db.query(models.KmvPriceCache.fetched_at)
                .order_by(models.KmvPriceCache.fetched_at.desc())
                .first()
            )
            if latest is None:
                return True
            newest: Optional[datetime] = latest[0]
            return newest is None or (datetime.utcnow() - newest) > timedelta(hours=12)
        finally:
            db.close()
    except Exception:
        return False


def _run_expiry_sweep() -> None:
    """
    One pass of the listing-expiry sweeper. Idempotent — safe to run more
    often than necessary. Wrapped in a fresh DB session; swallows all
    errors so a bad row can't stop the loop.
    """
    try:
        import database
        import models
        from notifications import notify
        now = datetime.utcnow()
        db = database.SessionLocal()
        try:
            expired = (
                db.query(models.CropListing)
                  .filter(models.CropListing.status == models.CropStatus.AVAILABLE)
                  .filter(models.CropListing.expires_at != None)  # noqa: E711
                  .filter(models.CropListing.expires_at <= now)
                  .all()
            )
            if not expired:
                return
            offers_cancelled_this_sweep = 0
            for lst in expired:
                # Flip listing status. Preserved in the DB for the farmer's
                # "Past listings" history; hidden from Discover feeds by
                # the AVAILABLE-only filters on read endpoints.
                lst.status = models.CropStatus.EXPIRED

                # Cancel any PENDING offers on this listing. IN_DELIVERY /
                # COMPLETED / ACCEPTED offers are trades already in flight —
                # never touch them, even if the listing's expiry window elapsed
                # (would strand a real delivery).
                pending_offers = (
                    db.query(models.TradeOffer)
                      .filter(models.TradeOffer.listing_id == lst.id)
                      .filter(models.TradeOffer.status == models.OfferStatus.PENDING)
                      .all()
                )
                for off in pending_offers:
                    off.status = models.OfferStatus.EXPIRED
                    off.cancelled_reason = "listing_expired"
                    offers_cancelled_this_sweep += 1
                    # Buyer-side notification
                    try:
                        notify(
                            db,
                            recipient_id=str(off.buyer_id),
                            role="buyer",
                            kind="OFFER_EXPIRED",
                            title="Offer no longer valid",
                            body=f"The {lst.crop_name} listing you offered on has expired.",
                            deep_link="/orders",
                        )
                    except Exception as _e:
                        log.warning("[scheduler] notify() failed during expiry sweep: %s", _e)

                # Farmer-side "your listing expired" notification.
                try:
                    notify(
                        db,
                        recipient_id=str(lst.farmer_id),
                        role="farmer",
                        kind="LISTING_EXPIRED",
                        title="Your listing expired",
                        body=f"Your {lst.crop_name} ({int(lst.quantity_kg)} kg) listing expired without a sale.",
                        deep_link="/market",
                    )
                except Exception:
                    pass

            db.commit()
            log.info("[scheduler] listing-expiry sweep: %d listings expired, %d pending offers cancelled",
                     len(expired), offers_cancelled_this_sweep)
        finally:
            db.close()
    except Exception as e:
        log.exception("[scheduler] listing-expiry sweep failed: %s", e)


def _loop() -> None:
    log.info("[scheduler] scheduler thread started (KMV + expiry)")
    if _cold_start_check():
        log.info("[scheduler] cold cache detected → kicking initial snapshot")
        _run_snapshot()
    # Run the expiry sweep immediately on boot so a listing that expired
    # overnight while the server was down doesn't linger in Discover.
    _run_expiry_sweep()
    while not _stop_evt.is_set():
        # Run the expiry sweep every 60 min. This is inside the same loop
        # as the KMV twice-daily job so we don't need a second thread — we
        # simply cap the max sleep between wake-ups at 1 hour.
        now = datetime.now(tz=IST)
        nxt_kmv = _next_slot(now)
        wait_s = min(3600.0, max(1.0, (nxt_kmv - now).total_seconds()))
        log.info("[scheduler] next wake in %.0f min (kmv slot at %s IST)",
                 wait_s / 60, nxt_kmv.strftime("%Y-%m-%d %H:%M"))
        if _stop_evt.wait(wait_s):
            break
        # If the sleep timed out AT the kmv slot, do the snapshot too.
        if (datetime.now(tz=IST) - nxt_kmv).total_seconds() >= -60:
            _run_snapshot()
        _run_expiry_sweep()


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_loop, name="kmv-scheduler", daemon=True)
    t.start()


def stop() -> None:
    _stop_evt.set()
