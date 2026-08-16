from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from models import ShopType, CropStatus, TransactionType

class FarmerProfileBase(BaseModel):
    phone_number: str
    full_name: str
    total_land_ha: float
    cattle_count: int = 0

class FarmerProfileCreate(FarmerProfileBase):
    pass

class FarmerProfile(FarmerProfileBase):
    id: UUID

    class Config:
        from_attributes = True

class BuyerProfileBase(BaseModel):
    phone_number: str
    shop_name: str
    shop_type: ShopType
    sourcing_radius_km: float

class BuyerProfileCreate(BuyerProfileBase):
    longitude: float
    latitude: float

class BuyerProfile(BuyerProfileBase):
    id: UUID

    class Config:
        from_attributes = True

class CropListingBase(BaseModel):
    crop_name: str
    quantity_kg: float
    calculated_price_per_kg: float

class CropListingCreate(CropListingBase):
    farmer_id: UUID
    longitude: float
    latitude: float

class CropListing(CropListingBase):
    id: UUID
    farmer_id: UUID
    status: CropStatus

    class Config:
        from_attributes = True

class FarmLedgerBase(BaseModel):
    farmer_id: UUID
    transaction_type: TransactionType
    amount: float
    category: str

class FarmLedgerCreate(FarmLedgerBase):
    pass

class FarmLedger(FarmLedgerBase):
    id: UUID
    timestamp: datetime

    class Config:
        from_attributes = True
