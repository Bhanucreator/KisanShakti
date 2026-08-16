from __future__ import annotations

import math
import os
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text

import models
import schemas
import database
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

# ─── Init DB tables on startup ───────────────────────────────────────────────

@app.on_event("startup")
def create_tables():
    database.Base.metadata.create_all(bind=database.engine)

# ─── Singletons ──────────────────────────────────────────────────────────────

_otp_store = OTPStore()
_DEBUG = os.getenv("DEBUG", "").lower() in {"1", "true", "yes"}

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
def send_otp(body: SendOTPRequest):
    code = _otp_store.generate(body.phone)
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
            buyer = models.BuyerProfile(
                id=str(uuid.uuid4()),
                phone_number=body.phone,
                shop_name=body.name or body.phone,
                shop_type=models.ShopType.KIRANA,
                sourcing_radius_km=10,
                shop_location="13.1367,78.1325",
            )
            db.add(buyer)
            db.commit()
            db.refresh(buyer)
        user_id = str(buyer.id)

    jwt_service = get_jwt_service()
    token = jwt_service.create_token(user_id=user_id, phone=body.phone, role=body.role)
    return VerifyOTPResponse(access_token=token, token_type="bearer", user_id=user_id, is_new_user=is_new_user)

# ─── Farmer Profile ───────────────────────────────────────────────────────────

@app.get("/api/v1/farmers/me")
def get_my_farmer_profile(farmer: models.FarmerProfile = Depends(get_current_farmer)):
    return {
        "id": str(farmer.id),
        "phone_number": farmer.phone_number,
        "full_name": farmer.full_name,
        "total_land_ha": float(farmer.total_land_ha),
        "cattle_count": farmer.cattle_count,
    }

@app.post("/api/v1/farmers/register")
def register_farmer(farmer_data: schemas.FarmerProfileBase, db: Session = Depends(database.get_db)):
    existing = db.query(models.FarmerProfile).filter_by(phone_number=farmer_data.phone_number).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Phone already registered.")
    farmer = models.FarmerProfile(
        id=str(uuid.uuid4()),
        phone_number=farmer_data.phone_number,
        full_name=farmer_data.full_name,
        total_land_ha=farmer_data.total_land_ha,
        cattle_count=farmer_data.cattle_count,
    )
    db.add(farmer)
    db.commit()
    db.refresh(farmer)
    return farmer

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

@app.post("/api/v1/buyers/preferences")
def save_buyer_preferences(shop_type: str, sourcing_radius_km: float):
    return {"status": "saved", "shop_type": shop_type, "sourcing_radius_km": sourcing_radius_km}

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


@app.post("/api/v1/crops/listing")
def create_crop_listing(
    crop_name: str,
    quantity_kg: float,
    calculated_price_per_kg: float,
    latitude: float = 13.1367,
    longitude: float = 78.1325,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    listing = models.CropListing(
        id=str(uuid.uuid4()),
        farmer_id=str(farmer.id),
        crop_name=crop_name,
        quantity_kg=quantity_kg,
        calculated_price_per_kg=calculated_price_per_kg,
        status=models.CropStatus.AVAILABLE,
        location=f"{latitude},{longitude}",
    )
    db.add(listing)
    db.commit()
    return {"status": "listed", "listing_id": str(listing.id)}

# ─── Smart Pricing ────────────────────────────────────────────────────────────

@app.post("/api/v1/pricing/smart-price")
def get_smart_price(crop_name: str, quality_modifier: float = 0.0):
    base_prices = {
        "Tomato": 20.0, "Potato": 15.0, "Onion": 25.0,
        "Cabbage": 18.0, "Carrot": 22.0, "Brinjal": 16.0,
        "Wheat": 22.0, "Rice": 32.0, "Corn": 18.0,
        "Sunflower": 45.0, "Groundnut": 50.0, "Sugarcane": 3.5,
    }
    quality_modifier = max(-0.05, min(0.05, quality_modifier))
    base = base_prices.get(crop_name, 30.0)
    return {"crop_name": crop_name, "smart_price": round(base * (1 + quality_modifier), 2)}

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


@app.post("/api/v1/farm-ledger")
def add_ledger_entry(
    transaction_type: str,
    amount: float,
    category: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    entry = models.FarmLedger(
        id=str(uuid.uuid4()),
        farmer_id=str(farmer.id),
        transaction_type=transaction_type,
        amount=amount,
        category=category,
        timestamp=datetime.utcnow(),
    )
    db.add(entry)
    db.commit()
    return {"status": "recorded", "id": str(entry.id)}
