"""
Notification feed — one row per event both parties care about.

Farmer events:
  OFFER_RECEIVED     — a buyer submitted an offer
  DELIVERY_COMPLETED — buyer entered OTP; income posted to ledger
  OFFER_WITHDRAWN    — buyer withdrew a pending offer
  WEATHER_ALERT      — high fungal / heavy rain incoming (weather feature)

Buyer events:
  OFFER_ACCEPTED     — farmer accepted; delivery started; OTP in the app
  OFFER_REJECTED     — farmer rejected
  DELIVERY_CANCELLED — farmer aborted a delivery in progress
  DELIVERY_MANUAL    — farmer manually marked delivered (buyer should verify)

Read-model: `GET /notifications` (paginated, newest first). Insert-model:
call `notify(db, recipient_id, role, kind, title, body, deep_link)` from
any hook site — keeps producer/consumer decoupled.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

import database
import models
from dependencies import get_current_buyer, get_current_farmer

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


# ── Producer helper ─────────────────────────────────────────────────────────

def notify(
    db:            Session,
    recipient_id:  str,
    role:          Literal["farmer", "buyer"],
    kind:          str,
    title:         str,
    body:          Optional[str] = None,
    deep_link:     Optional[str] = None,
) -> models.Notification:
    """
    Insert a notification row. Caller is responsible for committing (usually
    at the end of the request handler that already writes other rows) so
    the notification atomically pairs with the event that triggered it.
    """
    n = models.Notification(
        id             = str(uuid.uuid4()),
        recipient_id   = recipient_id,
        recipient_role = role,
        kind           = kind,
        title          = title,
        body           = body,
        deep_link      = deep_link,
        created_at     = datetime.utcnow(),
    )
    db.add(n)
    return n


# ── Read schemas ────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id:         str
    kind:       str
    title:      str
    body:       Optional[str]
    deep_link:  Optional[str]
    read:       bool
    created_at: datetime


class NotificationsResponse(BaseModel):
    total:  int
    unread: int
    items:  List[NotificationOut]


# ── Endpoints ───────────────────────────────────────────────────────────────

def _current_recipient(farmer: Optional[models.FarmerProfile], buyer: Optional[models.BuyerProfile]) -> tuple[str, str]:
    """Return (recipient_id, role) — exactly one of farmer/buyer must be present."""
    if farmer is not None:
        return str(farmer.id), "farmer"
    if buyer is not None:
        return str(buyer.id), "buyer"
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")


@router.get("/farmer", response_model=NotificationsResponse)
def list_for_farmer(
    limit:  int = Query(50, ge=1, le=200),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db:     Session = Depends(database.get_db),
):
    return _list(db, str(farmer.id), "farmer", limit)


@router.get("/buyer", response_model=NotificationsResponse)
def list_for_buyer(
    limit: int = Query(50, ge=1, le=200),
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db:    Session = Depends(database.get_db),
):
    return _list(db, str(buyer.id), "buyer", limit)


def _list(db: Session, recipient_id: str, role: str, limit: int) -> NotificationsResponse:
    q = (
        db.query(models.Notification)
        .filter_by(recipient_id=recipient_id, recipient_role=role)
        .order_by(desc(models.Notification.created_at))
    )
    total  = q.count()
    unread = (
        db.query(models.Notification)
        .filter_by(recipient_id=recipient_id, recipient_role=role, read=False)
        .count()
    )
    items  = q.limit(limit).all()
    return NotificationsResponse(
        total  = total,
        unread = unread,
        items  = [
            NotificationOut(
                id=str(n.id), kind=n.kind, title=n.title, body=n.body,
                deep_link=n.deep_link, read=bool(n.read), created_at=n.created_at,
            )
            for n in items
        ],
    )


@router.post("/farmer/{notif_id}/read")
def mark_read_farmer(
    notif_id: str,
    farmer:   models.FarmerProfile = Depends(get_current_farmer),
    db:       Session = Depends(database.get_db),
):
    return _mark_read(db, notif_id, str(farmer.id), "farmer")


@router.post("/buyer/{notif_id}/read")
def mark_read_buyer(
    notif_id: str,
    buyer:    models.BuyerProfile = Depends(get_current_buyer),
    db:       Session = Depends(database.get_db),
):
    return _mark_read(db, notif_id, str(buyer.id), "buyer")


def _mark_read(db: Session, notif_id: str, recipient_id: str, role: str) -> dict:
    n = db.get(models.Notification, notif_id)
    if not n or n.recipient_id != recipient_id or n.recipient_role != role:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    if not n.read:
        n.read = True
        db.commit()
    return {"status": "ok"}


@router.post("/farmer/read-all")
def mark_all_read_farmer(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db:     Session = Depends(database.get_db),
):
    return _mark_all_read(db, str(farmer.id), "farmer")


@router.post("/buyer/read-all")
def mark_all_read_buyer(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db:    Session = Depends(database.get_db),
):
    return _mark_all_read(db, str(buyer.id), "buyer")


def _mark_all_read(db: Session, recipient_id: str, role: str) -> dict:
    updated = (
        db.query(models.Notification)
        .filter_by(recipient_id=recipient_id, recipient_role=role, read=False)
        .update({"read": True})
    )
    db.commit()
    return {"status": "ok", "updated": updated}


# ── Delete / clear ─────────────────────────────────────────────────────────

@router.delete("/farmer/{notif_id}")
def delete_farmer_notification(
    notif_id: str,
    farmer:   models.FarmerProfile = Depends(get_current_farmer),
    db:       Session = Depends(database.get_db),
):
    return _delete_one(db, notif_id, str(farmer.id), "farmer")


@router.delete("/buyer/{notif_id}")
def delete_buyer_notification(
    notif_id: str,
    buyer:    models.BuyerProfile = Depends(get_current_buyer),
    db:       Session = Depends(database.get_db),
):
    return _delete_one(db, notif_id, str(buyer.id), "buyer")


def _delete_one(db: Session, notif_id: str, recipient_id: str, role: str) -> dict:
    n = db.get(models.Notification, notif_id)
    if not n or n.recipient_id != recipient_id or n.recipient_role != role:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    db.delete(n)
    db.commit()
    return {"status": "deleted"}


@router.delete("/farmer")
def clear_all_farmer(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db:     Session = Depends(database.get_db),
):
    return _clear_all(db, str(farmer.id), "farmer")


@router.delete("/buyer")
def clear_all_buyer(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
    db:    Session = Depends(database.get_db),
):
    return _clear_all(db, str(buyer.id), "buyer")


def _clear_all(db: Session, recipient_id: str, role: str) -> dict:
    deleted = (
        db.query(models.Notification)
        .filter_by(recipient_id=recipient_id, recipient_role=role)
        .delete()
    )
    db.commit()
    return {"status": "ok", "deleted": deleted}
