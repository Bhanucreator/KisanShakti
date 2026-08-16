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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Farmer profile not found.")
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Buyer profile not found.")
    return buyer


# Re-export jwt_service so main.py can use it for auth routes
def get_jwt_service() -> JWTService:
    return _jwt_service
