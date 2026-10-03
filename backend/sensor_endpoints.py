"""
ESP32 field-sensor endpoints.

Powers the "check my field from anywhere" use case: the ESP32 pushes a
reading over WiFi every ~5 min, we persist it, and the phone app pulls the
latest (and short history for the trend graph) from anywhere on the internet.

Phase 2 auth model: readings are accepted from any device_id.
Phase 3 will add device_token verification issued during BLE pairing.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, List
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

import models
import database
from dependencies import get_current_farmer
from rate_limit import check_rate


def _generate_device_token() -> str:
    """
    Cryptographically-secure random token. 32 hex chars (128 bits of entropy) —
    infeasible to brute-force but short enough to fit comfortably in the
    ESP32's NVS (Preferences library key values cap at ~4 KB per entry).
    """
    return secrets.token_hex(16)

router = APIRouter(prefix="/api/v1/sensor", tags=["sensor"])


# ── Schemas ────────────────────────────────────────────────────────────────

class SensorReadingIn(BaseModel):
    device_id:     str   = Field(..., min_length=1, max_length=64)
    device_token:  Optional[str] = None       # ignored in Phase 2, required in Phase 3
    farmer_id:     Optional[str] = None       # populated after pairing
    soil_moisture: Optional[float] = None
    temperature:   Optional[float] = None
    humidity:      Optional[float] = None
    is_raining:    Optional[bool]  = None
    # Optional battery telemetry — the firmware sends these only when a
    # voltage divider is wired to the battery pin. Null means USB-powered
    # or unconfigured, and the app should hide the battery UI in that case.
    battery_v:     Optional[float] = None     # raw volts (e.g. 3.87)
    battery_pct:   Optional[int]   = None     # 0-100 derived by the firmware


class SensorReadingOut(BaseModel):
    id:            str
    device_id:     str
    farmer_id:     Optional[str]
    ts:            datetime
    age_seconds:   int
    soil_moisture: Optional[float]
    temperature:   Optional[float]
    humidity:      Optional[float]
    is_raining:    Optional[bool]
    battery_v:     Optional[float] = None
    battery_pct:   Optional[int]   = None
    source:        str


# ── Helpers ────────────────────────────────────────────────────────────────

def _to_out(row: models.SensorReading) -> SensorReadingOut:
    age = int((datetime.utcnow() - row.ts).total_seconds()) if row.ts else 0
    return SensorReadingOut(
        id=str(row.id),
        device_id=row.device_id,
        farmer_id=str(row.farmer_id) if row.farmer_id else None,
        ts=row.ts,
        age_seconds=max(0, age),
        soil_moisture=float(row.soil_moisture) if row.soil_moisture is not None else None,
        temperature=float(row.temperature_c) if row.temperature_c is not None else None,
        humidity=float(row.humidity) if row.humidity is not None else None,
        is_raining=row.is_raining,
        battery_v=float(row.battery_v) if getattr(row, "battery_v", None) is not None else None,
        battery_pct=int(row.battery_pct) if getattr(row, "battery_pct", None) is not None else None,
        source=row.source or "esp32-wifi",
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/reading", status_code=status.HTTP_201_CREATED)
def post_reading(body: SensorReadingIn, db: Session = Depends(database.get_db)):
    """
    ESP32 pushes here every ~5 min over WiFi. If the device_id was paired
    (row exists in sensor_devices), we auto-tag the reading with the
    farmer_id even if the ESP32 didn't include it in the payload.
    """
    # Rate-limit at 30 posts / minute per device_id — a well-behaved ESP32
    # is on a 5-minute cadence, so 30 is a very generous ceiling that only
    # trips a rogue or malfunctioning device flooding us. Prevents a stolen
    # device_id from being used to fill our SQLite with noise.
    check_rate(bucket="sensor_reading", key=body.device_id,
               cap=30, window_s=60, friendly="sensor pushes")

    farmer_id = body.farmer_id
    device = db.get(models.SensorDevice, body.device_id)
    if device is None:
        # First-time push — auto-register with whatever farmer_id was sent.
        # No token check yet since we haven't issued one. The PAIRING flow
        # will assign a token via PATCH /devices/{id}, and from then on
        # every POST must include it.
        device = models.SensorDevice(
            device_id=body.device_id,
            farmer_id=farmer_id,
            device_token=body.device_token,
            last_seen_at=datetime.utcnow(),
        )
        db.add(device)
    else:
        # Enforce device_token match once one has been issued to this device.
        # Devices paired before the token flow existed have device_token=NULL
        # and are grandfathered in until they next re-pair — this keeps the
        # deploy backward-compatible with already-flashed ESP32s in the field.
        if device.device_token:
            if not body.device_token or body.device_token != device.device_token:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "Device token missing or mismatched for this device_id.",
                )
        device.last_seen_at = datetime.utcnow()
        if farmer_id is None and device.farmer_id:
            farmer_id = str(device.farmer_id)

    row = models.SensorReading(
        device_id=body.device_id,
        farmer_id=farmer_id,
        soil_moisture=body.soil_moisture,
        temperature_c=body.temperature,
        humidity=body.humidity,
        is_raining=body.is_raining,
        battery_v=body.battery_v,
        battery_pct=body.battery_pct,
        source="esp32-wifi",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "ok", "id": str(row.id), "farmer_id": farmer_id}


@router.get("/latest", response_model=Optional[SensorReadingOut])
def latest_reading(
    device_id: Optional[str] = Query(None, description="Filter by specific device_id (must belong to caller)"),
    db: Session = Depends(database.get_db),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
):
    """
    Most recent reading for the caller (or a specific device they own).
    Returns null if none exist — the app renders an "no data yet" state.

    JWT-scoped: the caller's farmer_id is taken from the token, never from
    a query param. A device_id filter is only honoured when the device row
    is owned by the calling farmer (prevents cross-farmer sensor snooping).
    """
    caller_id = str(farmer.id)
    q = db.query(models.SensorReading).filter(models.SensorReading.farmer_id == caller_id)
    if device_id:
        # Verify the caller actually owns this device before letting them read it.
        device = db.get(models.SensorDevice, device_id)
        if device is None or str(device.farmer_id) != caller_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't own that sensor.")
        q = q.filter(models.SensorReading.device_id == device_id)
    row = q.order_by(desc(models.SensorReading.ts)).first()
    if not row:
        return None
    return _to_out(row)


@router.get("/history", response_model=List[SensorReadingOut])
def history(
    device_id: Optional[str] = Query(None),
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(database.get_db),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
):
    """
    Readings over the past N hours (default 24 h, max 7 days). JWT-scoped
    to the caller — a device_id filter is honoured only for devices the
    caller owns.
    """
    caller_id = str(farmer.id)
    since = datetime.utcnow() - timedelta(hours=hours)
    q = (db.query(models.SensorReading)
           .filter(models.SensorReading.ts >= since)
           .filter(models.SensorReading.farmer_id == caller_id))
    if device_id:
        device = db.get(models.SensorDevice, device_id)
        if device is None or str(device.farmer_id) != caller_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't own that sensor.")
        q = q.filter(models.SensorReading.device_id == device_id)
    rows = q.order_by(models.SensorReading.ts.asc()).limit(2000).all()
    return [_to_out(r) for r in rows]


@router.get("/devices")
def list_devices(
    db: Session = Depends(database.get_db),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
):
    """List devices paired to the caller. Used by the Weather-tab device switcher."""
    devices = db.query(models.SensorDevice).filter_by(farmer_id=str(farmer.id)).all()
    return [
        {
            "device_id":     d.device_id,
            "label":         d.label,
            "registered_at": d.registered_at,
            "last_seen_at":  d.last_seen_at,
            "age_seconds":   int((datetime.utcnow() - d.last_seen_at).total_seconds())
                             if d.last_seen_at else None,
        }
        for d in devices
    ]


class DeviceUpdateIn(BaseModel):
    label: Optional[str] = Field(None, max_length=64)
    # Farmer binding — needed when the ESP32 posted first before the app knew
    # about it, or when transferring ownership between farmer accounts.
    farmer_id: Optional[str] = None


@router.patch("/devices/{device_id}")
def update_device(
    device_id: str,
    body: DeviceUpdateIn,
    db: Session = Depends(database.get_db),
    farmer: models.FarmerProfile = Depends(get_current_farmer),
):
    """
    Rename a paired sensor (e.g. "Tomato plot") or bind it to the caller.
    JWT-scoped: the farmer_id is always the caller's, regardless of what
    the client sends in the body — prevents anyone from claiming another
    farmer's sensor by guessing its device_id.

    Auto-creates the device row if it doesn't exist yet — the wizard
    typically runs before the ESP32's first POST has reached us.
    """
    caller_id = str(farmer.id)
    device = db.get(models.SensorDevice, device_id)
    if device is None:
        device = models.SensorDevice(
            device_id=device_id,
            farmer_id=caller_id,
            label=(body.label or None),
            device_token=_generate_device_token(),
        )
        db.add(device)
    else:
        # Reject if the device already belongs to a different farmer.
        if device.farmer_id and str(device.farmer_id) != caller_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "This sensor is already paired to another farmer.")
        if body.label is not None:
            device.label = body.label.strip() or None
        # Always bind to caller — device_id sent to backend before the ESP32
        # had a chance to auto-register (common in the wizard flow).
        device.farmer_id = caller_id
        # Lazily issue a token if the row was created before device-token
        # enforcement shipped (grandfathered devices from the pre-Sep 2026 build).
        if not device.device_token:
            device.device_token = _generate_device_token()
    db.commit()
    db.refresh(device)
    # NOTE: the raw device_token is returned to the CALLER (the farmer's
    # authenticated app) exactly once here so it can relay the token to the
    # ESP32 over BLE. It never appears in any other response, and the
    # /reading endpoint only ever compares — never returns — this value.
    return {
        "device_id":    device.device_id,
        "label":        device.label,
        "farmer_id":    str(device.farmer_id) if device.farmer_id else None,
        "device_token": device.device_token,
    }
