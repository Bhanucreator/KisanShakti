from sqlalchemy import Column, String, Numeric, Integer, ForeignKey, Enum as SQLEnum, DateTime
from sqlalchemy.sql import func
from database import Base
import uuid
import enum


class ShopType(str, enum.Enum):
    KIRANA = "KIRANA"
    RESTAURANT = "RESTAURANT"
    WHOLESALER = "WHOLESALER"


class CropStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    LOCKED = "LOCKED"
    SOLD = "SOLD"


class TransactionType(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class FarmerProfile(Base):
    __tablename__ = "farmer_profiles"

    # String UUID works with both SQLite and PostgreSQL
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    phone_number = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    total_land_ha = Column(Numeric, nullable=False, default=0.0)
    cattle_count = Column(Integer, default=0)


class BuyerProfile(Base):
    __tablename__ = "buyer_profiles"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    phone_number = Column(String, unique=True, index=True, nullable=False)
    shop_name = Column(String, nullable=False)
    shop_type = Column(SQLEnum(ShopType), nullable=False)
    sourcing_radius_km = Column(Numeric, nullable=False, default=10)
    # Store lat,lon as "lat,lon" text — no PostGIS needed for dev
    shop_location = Column(String, nullable=False, default="13.1367,78.1325")


class CropListing(Base):
    __tablename__ = "crop_listings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    crop_name = Column(String, nullable=False)
    quantity_kg = Column(Numeric, nullable=False)
    calculated_price_per_kg = Column(Numeric, nullable=False)
    status = Column(SQLEnum(CropStatus), default=CropStatus.AVAILABLE, nullable=False)
    # Store as "lat,lon" text
    location = Column(String, nullable=False, default="13.1367,78.1325")


class FarmLedger(Base):
    __tablename__ = "farm_ledger"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    transaction_type = Column(SQLEnum(TransactionType), nullable=False)
    amount = Column(Numeric, nullable=False)
    category = Column(String, nullable=False)
    timestamp = Column(DateTime, server_default=func.now(), nullable=False)
