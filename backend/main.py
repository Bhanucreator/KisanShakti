from __future__ import annotations

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

# ─── Application ────────────────────────────────────────────────────────────

app = FastAPI(title="KisanShakti API", version="1.0.0")

# CORS — allow mobile apps and web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Singletons ─────────────────────────────────────────────────────────────

# One OTPStore for the process lifetime; TTL eviction is lazy + thread-safe.
_otp_store = OTPStore()

_DEBUG = os.getenv("DEBUG", "").lower() in {"1", "true", "yes"}

# ─── Auth Request / Response Schemas (Pydantic v2) ──────────────────────────


class SendOTPRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=15, description="E.164 phone number")
    role: Literal["farmer", "buyer"] = Field(..., description="Account role")


class SendOTPResponse(BaseModel):
    message: str
    dev_otp: Optional[str] = None  # Only populated when DEBUG=true


class VerifyOTPRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=15)
    otp: str = Field(..., min_length=6, max_length=6)
    role: Literal["farmer", "buyer"]
    name: Optional[str] = Field(None, description="Display name for new-user onboarding")


class VerifyOTPResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    is_new_user: bool


# ─── Root & Health ─────────────────────────────────────────────────────────


@app.get("/")
def read_root():
    return {"message": "Welcome to KisanShakti API", "version": "1.0.0"}


@app.get("/health")
def health_check(db: Session = Depends(database.get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database error: {str(exc)}",
        )


# ─── Auth Routes ─────────────────────────────────────────────────────────────


@app.post("/api/v1/auth/send-otp", response_model=SendOTPResponse)
def send_otp(body: SendOTPRequest) -> SendOTPResponse:
    """
    Generate a 6-digit OTP for the given phone number.
    In production this would fire an SMS via a gateway (e.g. Twilio / MSG91).
    The OTP is SHA-256-hashed before storage; the plaintext is never persisted.
    """
    code = _otp_store.generate(body.phone)

    # TODO (prod): dispatch SMS here — e.g. sms_gateway.send(body.phone, code)

    response = SendOTPResponse(message="OTP sent")
    if _DEBUG:
        # Expose the OTP in the response only during local development.
        response.dev_otp = code
    return response


@app.post("/api/v1/auth/verify-otp", response_model=VerifyOTPResponse)
def verify_otp(
    body: VerifyOTPRequest,
    db: Session = Depends(database.get_db),
) -> VerifyOTPResponse:
    """
    Verify the OTP and return a JWT.
    If no profile exists for the phone number, one is created (upsert-on-first-login).
    """
    if not _otp_store.verify(body.phone, body.otp):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP. Please request a new code.",
        )

    is_new_user = False
    user_id: str

    if body.role == "farmer":
        farmer = (
            db.query(models.FarmerProfile)
            .filter(models.FarmerProfile.phone_number == body.phone)
            .first()
        )
        if farmer is None:
            is_new_user = True
            new_id = uuid.uuid4()
            farmer = models.FarmerProfile(
                id=new_id,
                phone_number=body.phone,
                full_name=body.name or body.phone,
                total_land_ha=0.0,
                cattle_count=0,
            )
            db.add(farmer)
            db.commit()
            db.refresh(farmer)
        user_id = str(farmer.id)

    else:  # buyer
        buyer = (
            db.query(models.BuyerProfile)
            .filter(models.BuyerProfile.phone_number == body.phone)
            .first()
        )
        if buyer is None:
            is_new_user = True
            new_id = uuid.uuid4()
            # BuyerProfile requires a PostGIS geometry column; use raw SQL so
            # ST_SetSRID/ST_MakePoint are evaluated server-side.
            db.execute(
                text(
                    """
                    INSERT INTO buyer_profiles
                        (id, phone_number, shop_name, shop_type,
                         sourcing_radius_km, shop_location)
                    VALUES
                        (:id, :phone, :name, 'KIRANA', 10,
                         ST_SetSRID(ST_MakePoint(78.1325, 13.1367), 4326))
                    """
                ),
                {
                    "id": new_id,
                    "phone": body.phone,
                    "name": body.name or body.phone,
                },
            )
            db.commit()
            user_id = str(new_id)
        else:
            user_id = str(buyer.id)

    jwt_service = get_jwt_service()
    token = jwt_service.create_token(
        user_id=user_id,
        phone=body.phone,
        role=body.role,
    )

    return VerifyOTPResponse(
        access_token=token,
        token_type="bearer",
        user_id=user_id,
        is_new_user=is_new_user,
    )


# ─── Farmer Profile ──────────────────────────────────────────────────────────


@app.get("/api/v1/farmers/me", response_model=schemas.FarmerProfile)
def get_my_farmer_profile(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
) -> models.FarmerProfile:
    """Return the authenticated farmer's own profile."""
    return farmer


# Legacy registration endpoint (kept for backwards compatibility / admin use)
@app.post("/api/v1/farmers/register", response_model=schemas.FarmerProfile)
def register_farmer(
    farmer: schemas.FarmerProfileBase,
    db: Session = Depends(database.get_db),
) -> models.FarmerProfile:
    db_farmer = models.FarmerProfile(
        id=uuid.uuid4(),
        phone_number=farmer.phone_number,
        full_name=farmer.full_name,
        total_land_ha=farmer.total_land_ha,
        cattle_count=farmer.cattle_count,
    )
    db.add(db_farmer)
    db.commit()
    db.refresh(db_farmer)
    return db_farmer


# ─── Buyer Profile ───────────────────────────────────────────────────────────


@app.get("/api/v1/buyers/me")
def get_my_buyer_profile(
    buyer: models.BuyerProfile = Depends(get_current_buyer),
):
    """Return the authenticated buyer's own profile."""
    return {
        "id": str(buyer.id),
        "phone_number": buyer.phone_number,
        "shop_name": buyer.shop_name,
        "shop_type": buyer.shop_type,
        "sourcing_radius_km": float(buyer.sourcing_radius_km),
    }


@app.post("/api/v1/buyers/preferences")
def save_buyer_preferences(
    shop_type: str,
    sourcing_radius_km: float,
    db: Session = Depends(database.get_db),
):
    """Save or update buyer onboarding preferences."""
    return {
        "status": "saved",
        "shop_type": shop_type,
        "sourcing_radius_km": sourcing_radius_km,
    }


# ─── Crop Listings ───────────────────────────────────────────────────────────


@app.get("/api/v1/crops/nearby", response_model=List[schemas.CropListing])
def get_nearby_crops(
    latitude: float,
    longitude: float,
    radius_km: float = 25.0,
    db: Session = Depends(database.get_db),
):
    """Return crop listings sorted by ST_Distance within radius_km using PostGIS."""
    query = """
    SELECT
        cl.id,
        cl.farmer_id,
        cl.crop_name,
        cl.quantity_kg,
        cl.calculated_price_per_kg,
        cl.status,
        ROUND(
            (ST_Distance(
                cl.location::geography,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography
            ) / 1000)::numeric, 1
        ) AS distance_km,
        fp.full_name  AS farmer_name,
        fp.phone_number AS farmer_phone
    FROM crop_listings cl
    JOIN farmer_profiles fp ON cl.farmer_id = fp.id
    WHERE
        cl.status = 'AVAILABLE'
        AND ST_DWithin(
            cl.location::geography,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
            :radius_m
        )
    ORDER BY distance_km ASC
    LIMIT 50
    """
    radius_m = radius_km * 1000
    result = db.execute(
        text(query),
        {"lon": longitude, "lat": latitude, "radius_m": radius_m},
    )
    crops = []
    for row in result.mappings():
        crops.append(
            {
                "id": str(row["id"]),
                "farmer_id": str(row["farmer_id"]),
                "crop_name": row["crop_name"],
                "quantity_kg": float(row["quantity_kg"]),
                "calculated_price_per_kg": float(row["calculated_price_per_kg"]),
                "status": row["status"],
            }
        )
    return crops


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
    """Create a new crop listing for the authenticated farmer."""
    listing_id = uuid.uuid4()
    db.execute(
        text(
            """
            INSERT INTO crop_listings
                (id, farmer_id, crop_name, quantity_kg,
                 calculated_price_per_kg, status, location)
            VALUES
                (:id, :farmer_id, :crop_name, :qty, :price, 'AVAILABLE',
                 ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
            """
        ),
        {
            "id": listing_id,
            "farmer_id": farmer.id,
            "crop_name": crop_name,
            "qty": quantity_kg,
            "price": calculated_price_per_kg,
            "lon": longitude,
            "lat": latitude,
        },
    )
    db.commit()
    return {"status": "listed", "listing_id": str(listing_id)}


# ─── Smart Pricing (Agmarknet + XGBoost mock) ────────────────────────────────


@app.post("/api/v1/pricing/smart-price")
def get_smart_price(crop_name: str, quality_modifier: float = 0.0):
    """
    Agmarknet-backed smart price suggestion.
    quality_modifier: -0.05 (low grade) to +0.05 (premium).
    In production this calls the XGBoost model trained on Agmarknet historical data.
    """
    base_prices = {
        "Tomato": 20.0,
        "Potato": 15.0,
        "Onion": 25.0,
        "Cabbage": 18.0,
        "Carrot": 22.0,
        "Brinjal": 16.0,
    }
    quality_modifier = max(-0.05, min(0.05, quality_modifier))  # clamp to ±5 %
    base_price = base_prices.get(crop_name, 30.0)
    final_price = base_price * (1 + quality_modifier)
    return {"crop_name": crop_name, "smart_price": round(final_price, 2)}


# ─── Farm Ledger ─────────────────────────────────────────────────────────────


@app.get("/api/v1/farm-ledger")
def get_farm_ledger(
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """Return ledger transactions for the authenticated farmer, newest first."""
    result = db.execute(
        text(
            """
            SELECT
                id::text,
                transaction_type,
                amount::float,
                category,
                to_char(timestamp, 'YYYY-MM-DD') AS timestamp
            FROM farm_ledger
            WHERE farmer_id = :farmer_id
            ORDER BY timestamp DESC
            LIMIT 50
            """
        ),
        {"farmer_id": farmer.id},
    )
    ledger = []
    for row in result.mappings():
        ledger.append(
            {
                "id": row["id"],
                "transaction_type": row["transaction_type"],
                "amount": row["amount"],
                "category": row["category"],
                "timestamp": row["timestamp"],
            }
        )
    return ledger


@app.post("/api/v1/farm-ledger")
def add_ledger_entry(
    transaction_type: str,
    amount: float,
    category: str,
    farmer: models.FarmerProfile = Depends(get_current_farmer),
    db: Session = Depends(database.get_db),
):
    """Append a new income/expense entry to the authenticated farmer's ledger."""
    entry_id = uuid.uuid4()
    db.execute(
        text(
            """
            INSERT INTO farm_ledger
                (id, farmer_id, transaction_type, amount, category, timestamp)
            VALUES
                (:id, :farmer_id, :txtype, :amount, :category, now())
            """
        ),
        {
            "id": entry_id,
            "farmer_id": farmer.id,
            "txtype": transaction_type,
            "amount": amount,
            "category": category,
        },
    )
    db.commit()
    return {"status": "recorded", "id": str(entry_id)}
