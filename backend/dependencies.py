"""
FastAPI dependency-injection layer.
Resolves TokenClaims -> FarmerProfile | BuyerProfile from DB.
"""

import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
import models
from auth import JWTService, TokenClaims
from database import get_db

_security = HTTPBearer()

_JWT_SECRET = os.getenv("JWT_SECRET", "kisanshakti-dev-secret-key-change-in-production-2026")
_jwt_service = JWTService(secret=_JWT_SECRET)


def get_token_claims(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> TokenClaims:
    return _jwt_service.decode_token(credentials.credentials)


import uuid


def get_current_farmer(
    claims: TokenClaims = Depends(get_token_claims),
    db: Session = Depends(get_db),
) -> models.FarmerProfile:
    if claims.role != "farmer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Farmer access only.")
    farmer = (
        db.query(models.FarmerProfile)
        .filter(models.FarmerProfile.phone_number == claims.phone)
        .first()
    )
    if not farmer:
        # Auto-provision if user holds a valid signed JWT (e.g. after DB migration/switch)
        farmer = models.FarmerProfile(
            id=str(uuid.uuid4()),
            phone_number=claims.phone,
            full_name=claims.phone,
            total_land_ha=0.0,
            cattle_count=0,
        )
        db.add(farmer)
        db.commit()
        db.refresh(farmer)
    return farmer


def get_current_buyer(
    claims: TokenClaims = Depends(get_token_claims),
    db: Session = Depends(get_db),
) -> models.BuyerProfile:
    if claims.role != "buyer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Buyer access only.")
    buyer = (
        db.query(models.BuyerProfile)
        .filter(models.BuyerProfile.phone_number == claims.phone)
        .first()
    )
    if not buyer:
        buyer = models.BuyerProfile(
            id=str(uuid.uuid4()),
            phone_number=claims.phone,
            shop_name="",
            shop_type=models.ShopType.KIRANA,
            sourcing_radius_km=10,
            shop_location="13.1367,78.1325",
        )
        db.add(buyer)
        db.commit()
        db.refresh(buyer)
    return buyer


# Re-export jwt_service so main.py can use it for auth routes
def get_jwt_service() -> JWTService:
    return _jwt_service
