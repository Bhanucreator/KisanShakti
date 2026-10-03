from sqlalchemy import Column, String, Numeric, Integer, ForeignKey, Enum as SQLEnum, DateTime, Date, Boolean, Index
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
    LOCKED    = "LOCKED"
    SOLD      = "SOLD"
    # Added Sep 2026 — per-crop shelf-life auto-expiry sweep flips
    # AVAILABLE listings past their expires_at to EXPIRED. Read paths
    # filter on AVAILABLE-only, so EXPIRED rows stay in the DB for the
    # farmer's "Past listings" history but disappear from Discover.
    EXPIRED   = "EXPIRED"


class TransactionType(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class CycleStatus(str, enum.Enum):
    PLANNED   = "PLANNED"
    GROWING   = "GROWING"
    HARVESTED = "HARVESTED"
    ABANDONED = "ABANDONED"


class TransferReason(str, enum.Enum):
    INITIAL     = "INITIAL"
    INHERITANCE = "INHERITANCE"
    PURCHASE    = "PURCHASE"
    SALE        = "SALE"


class Notification(Base):
    """
    In-app notification feed. Both farmers and buyers accrue events here;
    `recipient_role` scopes to the right app.

    Each notification is a snapshot of what happened at that moment (title +
    body + optional deep_link). If the underlying object (listing, offer)
    later disappears, the notification remains readable — the point is a
    log of "what changed for you", not a live reference.
    """
    __tablename__ = "notifications"

    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient_id   = Column(String, nullable=False, index=True)
    recipient_role = Column(String, nullable=False)     # 'farmer' | 'buyer'
    kind           = Column(String, nullable=False)     # OFFER_RECEIVED, DELIVERY_STARTED, etc
    title          = Column(String, nullable=False)
    body           = Column(String, nullable=True)
    deep_link      = Column(String, nullable=True)      # e.g. /market or /orders?offerId=xxx
    read           = Column(Boolean, nullable=False, default=False)
    created_at     = Column(DateTime, server_default=func.now(), nullable=False)


Index(
    "ix_notifications_recipient_created",
    Notification.recipient_id,
    Notification.created_at.desc(),
)


class OfferStatus(str, enum.Enum):
    PENDING     = "PENDING"
    ACCEPTED    = "ACCEPTED"        # legacy — kept so old rows deserialise
    IN_DELIVERY = "IN_DELIVERY"     # farmer accepted, OTP generated, crop moving
    COMPLETED   = "COMPLETED"       # buyer entered OTP → ledger post fires
    REJECTED    = "REJECTED"
    WITHDRAWN   = "WITHDRAWN"
    EXPIRED     = "EXPIRED"
    CANCELLED   = "CANCELLED"       # farmer cancelled mid-delivery


class FarmerProfile(Base):
    __tablename__ = "farmer_profiles"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    phone_number = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    total_land_ha = Column(Numeric, nullable=False, default=0.0)
    cattle_count = Column(Integer, default=0)
    location_name = Column(String, nullable=True)
    latitude = Column(Numeric, nullable=True)
    longitude = Column(Numeric, nullable=True)


class FarmerCrop(Base):
    __tablename__ = "farmer_crops"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    crop_name = Column(String, nullable=False)
    crop_name_kn = Column(String, nullable=True)
    land_ha = Column(Numeric, nullable=False)


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
    """
    A crop the farmer is offering for sale in the Hyperlocal Commerce Engine.
    Buyers in the Mandi app discover these by proximity + price fairness.
    """
    __tablename__ = "crop_listings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    # Optional link to the crop cycle this listing represents (Business tab).
    # When the listing sells, we auto-post the income to the cycle's ledger.
    plot_id  = Column(String, ForeignKey("plots.id"),           nullable=True, index=True)
    cycle_id = Column(String, ForeignKey("crop_cycles.id"),     nullable=True, index=True)
    crop_name = Column(String, nullable=False)
    crop_name_kn = Column(String, nullable=True)
    quantity_kg = Column(Numeric, nullable=False)
    calculated_price_per_kg = Column(Numeric, nullable=False)
    status = Column(SQLEnum(CropStatus), default=CropStatus.AVAILABLE, nullable=False)
    # Backward-compat text "lat,lon" AND parallel numeric columns. Old code
    # keeps reading `location`; the new commerce endpoints use lat/lng for
    # Haversine and (eventually) PostGIS indexing.
    location  = Column(String,  nullable=False, default="13.1367,78.1325")
    latitude  = Column(Numeric, nullable=True)
    longitude = Column(Numeric, nullable=True)
    # Snapshot of the AGMARKNET benchmark price used to validate the listing.
    # Storing it means the "fair price" badge stays truthful even if the live
    # benchmark drifts after the listing was posted.
    benchmark_price_at_listing = Column(Numeric, nullable=True)
    # Relative path under backend/uploads/ (e.g. "listings/<uuid>.jpg").
    # Served publicly via /uploads/... — buyers on Mandi see the same photo.
    photo_path = Column(String, nullable=True)
    # Human-friendly village/hamlet name — reverse-geocoded from lat/lng on
    # listing create. Buyers often know nearby villages; showing "Chinnahalli"
    # beside the distance builds more trust than "3.2 km" alone.
    village = Column(String, nullable=True)
    # ── Auto-price-fit source (Hyperlocal Commerce · auto-APMC) ──
    # When the listing was created via the /pricing/suggest flow, we snapshot
    # WHICH APMC quoted this price so the buyer can see the provenance
    # ("Fitted from Bangarpet APMC · 13 km · today's modal ₹6/kg"). All five
    # are nullable — legacy listings and manually-typed prices leave them blank.
    market_source_apmc         = Column(String,  nullable=True)
    market_source_district     = Column(String,  nullable=True)
    market_source_price_kg     = Column(Numeric, nullable=True)
    market_source_distance_km  = Column(Numeric, nullable=True)
    market_source_date         = Column(String,  nullable=True)   # DD/MM/YYYY as returned by KMV
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    expires_at = Column(DateTime, nullable=True)


class ListingPhoto(Base):
    """
    Extra photos attached to a CropListing (up to 5 per listing).
    The first photo (sort_order=0) is the primary — mirrored to
    CropListing.photo_path for backward compat with older Mandi builds.
    """
    __tablename__ = "listing_photos"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    listing_id = Column(String, ForeignKey("crop_listings.id"), nullable=False, index=True)
    photo_path = Column(String, nullable=False)  # e.g. "listings/<uuid>_1.jpg"
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class FarmerRating(Base):
    """
    Post-delivery rating from a buyer to a farmer. One rating per completed
    offer (offer_id UNIQUE). Aggregated into farmer.avg_rating + count on
    listing/profile responses so buyers see trust signals at browse time.
    """
    __tablename__ = "farmer_ratings"

    id        = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=False, index=True)
    buyer_id  = Column(String, ForeignKey("buyer_profiles.id"),  nullable=False, index=True)
    offer_id  = Column(String, ForeignKey("trade_offers.id"),    nullable=False, unique=True, index=True)
    stars     = Column(Integer, nullable=False)   # 1..5
    comment   = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class TradeOffer(Base):
    """
    Buyer's counter-offer against a listing. If accepted by the farmer, the
    listing's status flips and (when plot_id is set) an INCOME entry is
    written to that plot's active cycle in the Business ledger.
    """
    __tablename__ = "trade_offers"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    listing_id   = Column(String, ForeignKey("crop_listings.id"), nullable=False, index=True)
    buyer_id     = Column(String, ForeignKey("buyer_profiles.id"), nullable=False, index=True)
    offered_price_per_kg = Column(Numeric, nullable=False)
    quantity_kg  = Column(Numeric, nullable=False)
    status       = Column(SQLEnum(OfferStatus), nullable=False, default=OfferStatus.PENDING)
    note         = Column(String, nullable=True)
    created_at   = Column(DateTime, server_default=func.now(), nullable=False)
    responded_at = Column(DateTime, nullable=True)
    expires_at   = Column(DateTime, nullable=False)          # 48 h from creation
    # 6-digit delivery OTP generated on ACCEPT. Buyer reads it aloud when
    # crop reaches them; farmer taps "Verify" or the buyer taps "Enter OTP"
    # on their side. Only on successful match does income post to ledger.
    delivery_otp = Column(String, nullable=True)
    completed_at = Column(DateTime, nullable=True)           # set on COMPLETE
    cancelled_reason = Column(String, nullable=True)         # farmer cancels mid-delivery
    # Soft-hide on the buyer's view only — buyer tapped the ✕ on a closed
    # request or past order to clean up their list. Row stays for the
    # farmer's history and any BI queries; buyer's list endpoints filter it out.
    hidden_from_buyer = Column(Boolean, nullable=False, default=False)


class PriceBenchmark(Base):
    """
    Cache of AGMARKNET benchmark prices per (crop_name, district). Refreshed
    every ~6 hours or on-demand when a listing needs validation. Keeping the
    cache lets listings/offers still validate when AGMARKNET is unreachable
    (spec: never silently drop the price safeguard).
    """
    __tablename__ = "price_benchmarks"

    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    crop_name       = Column(String, nullable=False, index=True)
    district        = Column(String, nullable=False, index=True)
    benchmark_price = Column(Numeric, nullable=False)
    source          = Column(String, nullable=False, default="agmarknet")
    fetched_at      = Column(DateTime, server_default=func.now(), nullable=False)


Index("ix_price_benchmarks_crop_district", PriceBenchmark.crop_name, PriceBenchmark.district)
Index("ix_crop_listings_status_created",  CropListing.status, CropListing.created_at.desc())


class KmvPriceCache(Base):
    """
    Per-market per-commodity per-day snapshot from Karnataka's KMV portal
    (krama.karnataka.gov.in). Populated by the KMV scraper on a cron and
    read by /api/v1/market/prices?source=kmv. See [[reference-kmv-portal]].
    Prices stored as ₹/kg (raw KMV ₹/quintal ÷ 100).
    """
    __tablename__ = "kmv_price_cache"

    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    district       = Column(String, nullable=True, index=True)
    market         = Column(String, nullable=False, index=True)
    commodity      = Column(String, nullable=False, index=True)
    variety        = Column(String, nullable=True)
    arrival_date   = Column(Date, nullable=False, index=True)
    arrivals_qtl   = Column(Numeric, nullable=True)
    min_price_kg   = Column(Numeric, nullable=False)
    max_price_kg   = Column(Numeric, nullable=False)
    modal_price_kg = Column(Numeric, nullable=False)
    fetched_at     = Column(DateTime, server_default=func.now(), nullable=False)


Index(
    "ix_kmv_price_unique",
    KmvPriceCache.market, KmvPriceCache.commodity,
    KmvPriceCache.variety, KmvPriceCache.arrival_date,
    unique=True,
)
Index("ix_kmv_price_crop_date", KmvPriceCache.commodity, KmvPriceCache.arrival_date.desc())


class FarmLedger(Base):
    __tablename__ = "farm_ledger"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    transaction_type = Column(SQLEnum(TransactionType), nullable=False)
    amount = Column(Numeric, nullable=False)
    category = Column(String, nullable=False)
    timestamp = Column(DateTime, server_default=func.now(), nullable=False)
    # Optional link to a crop cycle. Entries without a cycle_id remain valid
    # "general" farm expenses and do NOT contribute to per-cycle ROI.
    cycle_id = Column(String, ForeignKey("crop_cycles.id"), nullable=True, index=True)
    # Fine-grained tag: SEEDS, FERTILIZER, LABOR, IRRIGATION, PESTICIDE,
    # EQUIPMENT, SALE, SUBSIDY, OTHER. Old rows will be NULL; treat as OTHER.
    subcategory = Column(String, nullable=True)


class Plot(Base):
    """
    A named land parcel. The anchor for generational farm history — the plot
    outlives any single farmer account. When ownership changes hands
    (inheritance, sale), rows in plot_ownership_history record it and
    current_farmer_id is updated. All crop_cycles stay attached to plot_id
    so the new owner inherits full history.
    """
    __tablename__ = "plots"

    id                 = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    current_farmer_id  = Column(String, ForeignKey("farmer_profiles.id"), nullable=False, index=True)
    label              = Column(String, nullable=False)          # e.g. "Plot 2" / "ಉತ್ತರದ ಹೊಲ"
    label_kn           = Column(String, nullable=True)
    area_ha            = Column(Numeric, nullable=False, default=0)
    latitude           = Column(Numeric, nullable=True)
    longitude          = Column(Numeric, nullable=True)
    soil_type          = Column(String,  nullable=True)          # optional, future use
    created_at         = Column(DateTime, server_default=func.now(), nullable=False)


class PlotOwnershipHistory(Base):
    """Audit trail of who has owned a plot. Row per transfer, plus INITIAL."""
    __tablename__ = "plot_ownership_history"

    id                = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    plot_id           = Column(String, ForeignKey("plots.id"), nullable=False, index=True)
    farmer_id         = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    transferred_from  = Column(String, ForeignKey("farmer_profiles.id"), nullable=True)  # null on INITIAL
    transferred_at    = Column(DateTime, server_default=func.now(), nullable=False)
    reason            = Column(SQLEnum(TransferReason), nullable=False, default=TransferReason.INITIAL)


class CropCycle(Base):
    """
    One crop, one plot, one season. The atomic unit of Farm Business analytics.
    ROI is computed once (on harvest) from the linked farm_ledger rows and
    cached here so read queries don't recompute on every load.
    """
    __tablename__ = "crop_cycles"

    id                    = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    plot_id               = Column(String, ForeignKey("plots.id"), nullable=False, index=True)
    logged_by_farmer_id   = Column(String, ForeignKey("farmer_profiles.id"), nullable=False)
    crop_name             = Column(String, nullable=False)
    crop_name_kn          = Column(String, nullable=True)
    sowing_date           = Column(Date, nullable=False)
    expected_harvest_date = Column(Date, nullable=True)
    actual_harvest_date   = Column(Date, nullable=True)
    status                = Column(SQLEnum(CycleStatus), nullable=False, default=CycleStatus.GROWING)
    # Cached aggregates — refreshed by /cycles/{id}/harvest and on entry add.
    total_revenue         = Column(Numeric, nullable=False, default=0)
    total_expenses        = Column(Numeric, nullable=False, default=0)
    net_profit            = Column(Numeric, nullable=True)           # null until harvested
    roi_percent           = Column(Numeric, nullable=True)           # null when expenses=0 OR not harvested
    notes                 = Column(String, nullable=True)
    created_at            = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at            = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


Index("ix_crop_cycles_plot_crop", CropCycle.plot_id, CropCycle.crop_name)
Index("ix_crop_cycles_plot_status", CropCycle.plot_id, CropCycle.status)


class SensorReading(Base):
    """
    Cloud-persisted field sensor readings pushed by the ESP32 over WiFi
    (every ~5 min). Lets the farmer see field state from anywhere — home,
    market, or while travelling — not just when their phone is nearby the box.

    device_id: printed on the physical kit label (e.g. "KS-A7F3")
    farmer_id: linked during the BLE pairing wizard
    source:    'esp32-wifi' | 'esp32-ble-bridged' | 'manual'
    """
    __tablename__ = "sensor_readings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    device_id = Column(String, nullable=False, index=True)
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=True, index=True)
    ts = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    soil_moisture = Column(Numeric, nullable=True)   # 0-100 %
    temperature_c = Column(Numeric, nullable=True)   # °C
    humidity      = Column(Numeric, nullable=True)   # 0-100 %
    is_raining    = Column(Boolean, nullable=True)
    # Battery telemetry — only populated when the ESP32 has a voltage
    # divider wired. Null means USB-powered or unconfigured, and the UI
    # hides the battery indicator in that case.
    battery_v     = Column(Numeric, nullable=True)   # raw volts (e.g. 3.87)
    battery_pct   = Column(Integer, nullable=True)   # 0-100 derived by firmware
    source        = Column(String,  nullable=False, default="esp32-wifi")


class SensorDevice(Base):
    """
    Registry of paired ESP32 kits. Filled in during the BLE pairing wizard
    (Phase 3). For Phase 2 we accept readings from any device_id — the
    device_token check is a no-op — and this table just tracks freshness.
    """
    __tablename__ = "sensor_devices"

    device_id = Column(String, primary_key=True)
    farmer_id = Column(String, ForeignKey("farmer_profiles.id"), nullable=True, index=True)
    device_token = Column(String, nullable=True)   # populated in Phase 3
    label = Column(String, nullable=True)          # e.g. "Field A"
    registered_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_seen_at  = Column(DateTime, nullable=True)


# Compound index for the common "latest reading per farmer" query
Index("ix_sensor_readings_farmer_ts", SensorReading.farmer_id, SensorReading.ts.desc())
