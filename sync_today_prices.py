"""
KisanShakti - Real-time APMC Price Sync Script
Run this script from your laptop to fetch today's live prices directly from
the Karnataka State APMC Portal (KRAMA) and sync them to:
  1. Local baseline cache (backend/data/kmv_seed.json)
  2. Local SQLite DB (if present)
  3. Live Render Cloud API (https://kisanshakti-backend.onrender.com)
"""
from __future__ import annotations

import sys
import os
import json
import uuid
from pathlib import Path
from datetime import date, datetime, timedelta
from decimal import Decimal

# Ensure backend modules can be imported
ROOT_DIR = Path(__file__).resolve().parent
if (ROOT_DIR / "backend").exists():
    sys.path.insert(0, str(ROOT_DIR / "backend"))
    BACKEND_DIR = ROOT_DIR / "backend"
else:
    sys.path.insert(0, str(ROOT_DIR))
    BACKEND_DIR = ROOT_DIR

try:
    import httpx
    from sources import kmv
except ImportError as e:
    print(f"Error importing dependencies: {e}")
    print("Please run: pip install httpx requests sqlalchemy")
    sys.exit(1)

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

TARGET_COMMODITIES = [
    "Tomato", "Carrot", "Potato", "Onion", "Raddish", "Chilli",
    "Cabbage", "Beans", "Cauliflower", "Capsicum", "Beetroot",
    "Brinjal", "Cucumber", "Ginger", "Garlic", "Banana", "Ragi",
    "Paddy", "Maize", "Groundnut", "Drumstick", "Ladies Finger"
]

RENDER_API_BASE = os.getenv("RENDER_API_URL", "https://kisanshakti-backend.onrender.com")
SYNC_KEY = os.getenv("SYNC_SECRET", "kisanshakti_sync_2026")


def main():
    print("==================================================================")
    print(">> KisanShakti Real-Time APMC Price Sync Worker")
    print(f"   Date: {date.today().strftime('%d %B %Y')}")
    print("==================================================================\n")

    print("[1/4] Discovering commodities on KRAMA portal...")
    try:
        all_comms = kmv.discover_commodities()
        print(f"      Found {len(all_comms)} commodity/variety streams on portal.")
    except Exception as e:
        print(f"      Failed to connect to KRAMA portal: {e}")
        return

    # Filter to target high-demand crops
    selected = []
    for c in all_comms:
        c_name = c.comm_name.lower()
        if any(t.lower() in c_name for t in TARGET_COMMODITIES):
            selected.append(c)

    print(f"      Selected {len(selected)} high-demand produce varieties to sync.")

    # Dates to fetch: today and previous 3 days (ensures no gap if run before 2 PM)
    today = date.today()
    dates_to_sync = [
        today,
        today - timedelta(days=1),
        today - timedelta(days=2),
        today - timedelta(days=3),
    ]

    print(f"\n[2/4] Fetching live mandi prices for dates: {[d.strftime('%d/%m/%Y') for d in dates_to_sync]}...")
    fetched_records: list[dict] = []
    seen_keys = set()

    for i, c in enumerate(selected, 1):
        clean_name = c.comm_name.split("/")[0].strip()
        print(f"      ({i}/{len(selected)}) Fetching {clean_name}...", end=" ", flush=True)
        count_for_c = 0
        for d in dates_to_sync:
            try:
                rows = kmv.fetch_prices_for(c, on_date=d)
                for r in rows:
                    key = (r.market.strip().upper(), r.commodity.strip(), r.arrival_date.isoformat())
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    fetched_records.append({
                        "market": r.market.strip().upper(),
                        "commodity": r.commodity.strip(),
                        "variety": r.variety.strip() if r.variety else None,
                        "arrival_date": r.arrival_date.isoformat(),
                        "arrivals_qtl": r.arrivals_qtl,
                        "min_price_kg": r.min_kg(),
                        "max_price_kg": r.max_kg(),
                        "modal_price_kg": r.modal_kg(),
                    })
                    count_for_c += 1
            except Exception:
                pass
        print(f"got {count_for_c} mandi arrivals.")

    print(f"\n      Total unique live arrivals scraped: {len(fetched_records)}")
    if not fetched_records:
        print("      No records retrieved. Please check your internet connection.")
        return

    # [3/4] Update baseline kmv_seed.json
    print("\n[3/4] Updating baseline dataset (backend/data/kmv_seed.json)...")
    seed_path = BACKEND_DIR / "data" / "kmv_seed.json"
    existing_seed = []
    if seed_path.exists():
        try:
            with open(seed_path, "r", encoding="utf-8") as f:
                existing_seed = json.load(f)
        except Exception:
            existing_seed = []

    # Merge: fetched_records overwrite existing older records for same (market, commodity, arrival_date)
    merged_dict = {}
    for r in existing_seed:
        k = (r["market"].strip().upper(), r["commodity"].strip(), r["arrival_date"])
        merged_dict[k] = r
    for r in fetched_records:
        k = (r["market"].strip().upper(), r["commodity"].strip(), r["arrival_date"])
        merged_dict[k] = r

    merged_list = list(merged_dict.values())
    try:
        seed_path.parent.mkdir(parents=True, exist_ok=True)
        with open(seed_path, "w", encoding="utf-8") as f:
            json.dump(merged_list, f, indent=2, ensure_ascii=False)
        print(f"      Saved {len(merged_list)} records to {seed_path}")
    except Exception as e:
        print(f"      Warning: could not write seed file: {e}")

    # [4/4] Sync to Local Database & Live Cloud
    print("\n[4/4] Syncing to database and live cloud...")

    # A: Local SQLite DB (if exists)
    db_file = BACKEND_DIR / "kisanshakti_dev.db"
    if db_file.exists():
        try:
            import database
            import models
            from datetime import timezone
            database.Base.metadata.create_all(bind=database.engine)
            with database.SessionLocal() as db:
                inserted_local = 0
                now = datetime.now(timezone.utc)
                for item in fetched_records:
                    arr_d = datetime.strptime(item["arrival_date"], "%Y-%m-%d").date()
                    existing = (
                        db.query(models.KmvPriceCache)
                        .filter(models.KmvPriceCache.market == item["market"])
                        .filter(models.KmvPriceCache.commodity == item["commodity"])
                        .filter(models.KmvPriceCache.arrival_date == arr_d)
                        .first()
                    )
                    if existing:
                        existing.min_price_kg = Decimal(str(item["min_price_kg"]))
                        existing.max_price_kg = Decimal(str(item["max_price_kg"]))
                        existing.modal_price_kg = Decimal(str(item["modal_price_kg"]))
                        if item.get("arrivals_qtl") is not None:
                            existing.arrivals_qtl = Decimal(str(item["arrivals_qtl"]))
                        existing.fetched_at = now
                    else:
                        db.add(models.KmvPriceCache(
                            id=str(uuid.uuid4()),
                            market=item["market"],
                            commodity=item["commodity"],
                            variety=item.get("variety"),
                            arrival_date=arr_d,
                            arrivals_qtl=Decimal(str(item["arrivals_qtl"])) if item.get("arrivals_qtl") is not None else None,
                            min_price_kg=Decimal(str(item["min_price_kg"])),
                            max_price_kg=Decimal(str(item["max_price_kg"])),
                            modal_price_kg=Decimal(str(item["modal_price_kg"])),
                            fetched_at=now,
                        ))
                    inserted_local += 1
                db.commit()
            print(f"      [Local SQLite] Synced {inserted_local} records to {db_file.name}")
        except Exception as e:
            print(f"      [Local SQLite] Note: {e}")

    # B: Live Render Cloud API
    print(f"      [Render Cloud] Pushing to {RENDER_API_BASE}...")
    try:
        # Push in batches of 100
        batch_size = 100
        total_pushed = 0
        headers = {"X-Sync-Key": SYNC_KEY, "Content-Type": "application/json"}
        with httpx.Client(timeout=30.0) as client:
            for i in range(0, len(fetched_records), batch_size):
                batch = fetched_records[i:i + batch_size]
                resp = client.post(
                    f"{RENDER_API_BASE}/api/v1/market/push-kmv",
                    json={"records": batch},
                    headers=headers
                )
                if resp.status_code == 200:
                    total_pushed += len(batch)
                elif resp.status_code == 404:
                    print("      [Render Cloud] Cloud backend has not redeployed the push endpoint yet.")
                    print("                     Commit & push your code to GitHub to enable cloud auto-sync.")
                    break
                else:
                    print(f"      [Render Cloud] Push error {resp.status_code}: {resp.text[:100]}")
                    break
        if total_pushed > 0:
            print(f"      [Render Cloud] Successfully updated {total_pushed} live records on Render!")
    except Exception as e:
        print(f"      [Render Cloud] Network push note: {e}")

    print("\n==================================================================")
    print("✅ Sync Complete! Your KisanShakti App now has real-time prices.")
    print("==================================================================")


if __name__ == "__main__":
    main()
