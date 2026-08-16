import os
import random
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base, FarmerProfile, BuyerProfile, CropListing, ShopType, CropStatus
import faker

# Kolar, Karnataka Coordinates
KOLAR_LAT = 13.1367
KOLAR_LON = 78.1292

# Setup DB
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/kisanshakti")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

fake = faker.Faker('en_IN')

def seed_data():
    db = SessionLocal()
    
    print("Creating tables if not exists...")
    Base.metadata.create_all(bind=engine)
    
    print("Clearing existing data...")
    db.query(CropListing).delete()
    db.query(FarmerProfile).delete()
    db.query(BuyerProfile).delete()
    db.commit()

    print("Seeding Farmers...")
    farmers = []
    for i in range(10):
        farmer = FarmerProfile(
            id=uuid.uuid4(),
            phone_number=fake.phone_number()[:15],
            full_name=fake.name(),
            total_land_ha=round(random.uniform(1.0, 10.0), 2),
            cattle_count=random.randint(0, 5)
        )
        farmers.append(farmer)
        db.add(farmer)
    db.commit()

    print("Seeding Buyers...")
    buyers = []
    shop_types = [ShopType.KIRANA, ShopType.RESTAURANT, ShopType.WHOLESALER]
    for i in range(5):
        # Add a slight random offset to Kolar coordinates (about 0-10 km radius)
        lat = KOLAR_LAT + random.uniform(-0.1, 0.1)
        lon = KOLAR_LON + random.uniform(-0.1, 0.1)
        
        buyer = BuyerProfile(
            id=uuid.uuid4(),
            phone_number=fake.phone_number()[:15],
            shop_name=f"{fake.company()} Store",
            shop_type=random.choice(shop_types),
            sourcing_radius_km=random.uniform(5.0, 25.0),
            shop_location=f"SRID=4326;POINT({lon} {lat})"
        )
        buyers.append(buyer)
        db.add(buyer)
    db.commit()

    print("Seeding Crop Listings...")
    crops = ["Tomato", "Potato", "Onion", "Carrot", "Ragi", "Rice"]
    for i in range(20):
        farmer = random.choice(farmers)
        lat = KOLAR_LAT + random.uniform(-0.1, 0.1)
        lon = KOLAR_LON + random.uniform(-0.1, 0.1)
        
        listing = CropListing(
            id=uuid.uuid4(),
            farmer_id=farmer.id,
            crop_name=random.choice(crops),
            quantity_kg=round(random.uniform(50.0, 500.0), 2),
            calculated_price_per_kg=round(random.uniform(15.0, 50.0), 2),
            status=CropStatus.AVAILABLE,
            location=f"SRID=4326;POINT({lon} {lat})"
        )
        db.add(listing)
    db.commit()
    
    db.close()
    print("Seeding complete: 10 farmers, 5 buyers, 20 crop listings.")

if __name__ == "__main__":
    seed_data()
