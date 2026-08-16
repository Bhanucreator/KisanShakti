from sqlalchemy import Column, String, Numeric, Integer, ForeignKey, Enum as SQLEnum, DateTime
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geometry
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    total_land_ha = Column(Numeric, nullable=False)
    cattle_count = Column(Integer, default=0)

class BuyerProfile(Base):
    __tablename__ = "buyer_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String, unique=True, index=True, nullable=False)
    shop_name = Column(String, nullable=False)
    shop_type = Column(SQLEnum(ShopType), nullable=False)
    sourcing_radius_km = Column(Numeric, nullable=False)
    shop_location = Column(Geometry('POINT', srid=4326, spatial_index=True), nullable=False)

class CropListing(Base):
    __tablename__ = "crop_listings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    farmer_id = Column(UUID(as_uuid=True), ForeignKey("farmer_profiles.id"), nullable=False)
    crop_name = Column(String, nullable=False)
    quantity_kg = Column(Numeric, nullable=False)
    calculated_price_per_kg = Column(Numeric, nullable=False)
    status = Column(SQLEnum(CropStatus), default=CropStatus.AVAILABLE, nullable=False)
    location = Column(Geometry('POINT', srid=4326, spatial_index=True), nullable=False)

class FarmLedger(Base):
    __tablename__ = "farm_ledger"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    farmer_id = Column(UUID(as_uuid=True), ForeignKey("farmer_profiles.id"), nullable=False)
    transaction_type = Column(SQLEnum(TransactionType), nullable=False)
    amount = Column(Numeric, nullable=False)
    category = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
