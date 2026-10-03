# KisanShakti Backend

FastAPI + SQLAlchemy + SQLite (Postgres-ready). Serves both mobile apps
— Upaj (farmer) and Mandi (buyer). Single-container, no external service
dependencies at runtime except OpenWeather and the two government market
data feeds.

**63 REST endpoints**, all under `/api/v1/`. Full OpenAPI schema at
`http://localhost:8000/docs` while the dev server is running.

---

## Run locally

```bash
python -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # then fill in the values
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open http://localhost:8000/docs for the Swagger UI.

`--host 0.0.0.0` is required if you want the app on your phone (real
device, not emulator) to reach the backend. On Android emulator use
`http://10.0.2.2:8000`; on a real phone use `http://<your-laptop-lan-ip>:8000`
after allowing port 8000 through your OS firewall.

---

## Requirements

Python **3.12**. Everything else is in `requirements.txt`. Notable deps:

- `fastapi` + `uvicorn` — HTTP layer
- `sqlalchemy` — ORM + auto-migration (see `main.py` startup event)
- `alembic` — versioned migrations (available but not currently the
  primary schema-evolution path; we lean on inline `PRAGMA table_info`
  + `ALTER TABLE` at startup for the SQLite beta)
- `httpx` — outbound calls to OpenWeather / Open-Meteo / AGMARKNET / KMV
- `PyJWT` — signs the auth tokens
- `python-dotenv` — loads `.env`
- `Pillow` — resizes uploaded listing photos

---

## Environment variables

See `.env.example` for the canonical list. Summary:

| Var | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | No (defaults to SQLite file) | `sqlite:///./kisanshakti_dev.db` locally; a `postgresql://` URL in prod |
| `JWT_SECRET` | **Yes** | Signs every login JWT. Must be ≥ 32 chars. Rotating invalidates all sessions. |
| `WEATHER_API_KEY` | No | OpenWeather API key. Falls back to keyless Open-Meteo when missing. |
| `AGMARKNET_API_KEY` | No | data.gov.in AGMARKNET key. Only used for the "Show all-India" toggle; Karnataka data comes from KMV regardless. |
| `DEBUG` | No | When `true`, `/auth/send-otp` echoes the OTP back in the response for dev auto-fill. MUST be false in prod. |

---

## Project layout

```
backend/
├── main.py                    # FastAPI app factory, auth endpoints, farm ledger, delete-account, auto-migrations
├── database.py                # SQLAlchemy engine + get_db dependency
├── models.py                  # All 16 ORM models
├── schemas.py                 # Legacy Pydantic schemas (mostly deprecated in favour of inline BaseModels)
├── dependencies.py            # JWT decode → FarmerProfile / BuyerProfile injectors
├── auth.py                    # OTPStore (SHA-256 hashed, TTL-evicted min-heap) + JWTService
├── rate_limit.py              # Shared sliding-window limiter used by OTP, /reading, offers
├── crop_shelf_life.py         # Per-crop shelf life in days → drives auto-expiry
├── notifications.py           # Notification model + insert helper + 11 read/mark/delete endpoints
├── scheduler.py               # Threading loop: KMV twice-daily + listing-expiry hourly
├── seed_mock_data.py          # Seed script for demo data (dev only)
├── home_endpoints.py          # Weather, market prices, rain-diary, agri-advisory, subsidies, forecast
├── commerce_endpoints.py      # Listings + offers + ratings + delivery OTP + photo upload
├── sensor_endpoints.py        # ESP32 POST /reading + JWT-scoped reads + device rename + token issue
├── bi_endpoints.py            # Farm Business — plots, cycles, ROI, expense analytics
├── ai/                        # ML training scripts + disease treatment DB builder
├── commerce/                  # Pricing calc + proximity ranking helpers
├── price/                     # Market-price proximity ranker
├── sources/                   # KMV scraper (Karnataka APMC) + cache refresh
├── data/                      # Static reference data (254 APMC locations across 9 states)
├── alembic/                   # Alembic migration scaffolding
├── tests/                     # pytest — HTTP integration tests
└── uploads/                   # Farmer-uploaded crop photos (gitignored; served via /uploads/*)
```

---

## Endpoints at a glance

Grouped by concern. Every farmer/buyer-scoped endpoint takes
`Authorization: Bearer <jwt>` and derives the identity from the token.

### Auth
- `POST /api/v1/auth/send-otp` — send 6-digit OTP (dev-stub, prod ready)
- `POST /api/v1/auth/verify-otp` — return JWT + role + `needs_profile` flag

### Farmer profile + business
- `GET  /api/v1/farmers/me`
- `PUT  /api/v1/farmers/profile`
- `DELETE /api/v1/farmers/me` — cascade delete everything owned by the farmer
- `GET  /api/v1/farm-ledger`, `POST /api/v1/farm-ledger`
- 17 `bi_endpoints.py` routes: plots, cycles, expenses, ROI, category analytics

### Buyer profile
- `GET   /api/v1/buyers/me`
- `PATCH /api/v1/buyers/me`
- `DELETE /api/v1/buyers/me` — cascade delete

### Commerce (Upaj creates, Mandi consumes)
- `GET  /api/v1/listings` — farmer's own (default excludes EXPIRED; `?include_expired=true` for history)
- `POST /api/v1/listings`
- `GET  /api/v1/listings/search?lat=&lng=&radius_km=` — buyer's Discover feed
- `GET  /api/v1/listings/{id}`, `PATCH`, `DELETE`
- `POST /api/v1/listings/{id}/photo`, `POST /api/v1/listings/{id}/photos`
- `POST /api/v1/listings/{id}/offers` — rate-limited to 20 per buyer per 5 min
- `PATCH /api/v1/offers/{id}` — accept/reject (accepting auto-rejects sibling offers)
- `POST /api/v1/offers/{id}/verify-otp` — delivery handoff
- `POST /api/v1/offers/{id}/rate` — farmer rating from buyer

### Sensor (ESP32)
- `POST /api/v1/sensor/reading` — the ESP32 posts here every ~5 min. Rate-limited 30/min per device_id. Requires per-device token once one has been issued.
- `GET  /api/v1/sensor/latest` — JWT-scoped
- `GET  /api/v1/sensor/history?hours=` — JWT-scoped
- `GET  /api/v1/sensor/devices` — JWT-scoped
- `PATCH /api/v1/sensor/devices/{device_id}` — rename + issue device_token

### Weather + market + advisory (public)
- `GET /api/v1/weather/current`
- `GET /api/v1/weather/forecast`
- `GET /api/v1/weather/rain-diary`
- `GET /api/v1/market/prices` — KMV primary, AGMARKNET fallback
- `GET /api/v1/insights/irrigation` — bundles irrigation + fungal + spray-window, tunes by crop stage when `farmer_id` is passed
- `GET /api/v1/subsidies` — curated feed

### Notifications
- `GET  /api/v1/notifications/farmer`, `GET  /api/v1/notifications/buyer`
- `POST /api/v1/notifications/farmer/{id}/read`, `POST /api/v1/notifications/buyer/{id}/read`
- `POST /api/v1/notifications/farmer/read-all`, `POST /api/v1/notifications/buyer/read-all`
- `DELETE /api/v1/notifications/farmer/{id}`, `DELETE /api/v1/notifications/buyer/{id}`
- `DELETE /api/v1/notifications/farmer`, `DELETE /api/v1/notifications/buyer`

---

## Background jobs (`scheduler.py`)

A single daemon thread runs two recurring jobs:

1. **KMV price refresh** — twice a day at 05:00 IST and 20:00 IST. Also
   runs on server boot if the cache is > 12 h stale. Scrapes all 162
   Karnataka APMC latest prices from `krama.karnataka.gov.in`.
2. **Listing-expiry sweep** — every hour (and on boot). Flips any
   AVAILABLE listing past its `expires_at` to EXPIRED, cancels any
   PENDING offers on it with `cancelled_reason = "listing_expired"`,
   and writes notification rows for both the farmer ("your listing
   expired") and each affected buyer ("your offer is no longer valid").

Per-crop shelf life lives in `crop_shelf_life.py`:

| Category | Crops | Auto-expire after |
|---|---|---|
| Perishable | Tomato, Coriander, Leafy greens | 3 days |
| Semi-perishable | Chilli, Brinjal, Cabbage, Okra | 5 days |
| Root/bulb | Onion, Potato, Carrot, Ginger | 10 days |
| Cash | Cotton, Sugarcane, Turmeric | 14 days |
| Grain | Ragi, Rice, Wheat, Maize, Pulses | 21 days |
| Unknown | — | 7 days (default) |

Both English and Kannada crop names resolve to the same shelf life.

---

## Rate limits

All handled by `rate_limit.check_rate(bucket, key, cap, window_s)`:

| Bucket | Key | Cap | Window |
|---|---|---|---|
| `otp_phone` | phone number | 3 | 1 h |
| `otp_ip` | client IP | 10 | 1 h |
| `sensor_reading` | `device_id` | 30 | 1 min |
| `offer_create` | `buyer_id` | 20 | 5 min |

In-memory sliding window (thread-safe deque per key). Enough for a
50-user beta; swap for Redis + a leaky-bucket at scale.

---

## Data honesty (baked into the code)

Two hard rules the whole backend respects:

- **Never fabricate prices/weather/sensor readings.** Endpoints return
  `{"status": "unavailable", "reason": "...", "hint": "..."}` and the
  mobile UI renders a truthful empty state. No default fallback numbers.
- **AGMARKNET requires a browser User-Agent.** `data.gov.in`'s
  aggregator silently hangs Python's default UA. Every request in
  `home_endpoints._agmarknet_fetch` sends a real Chrome UA.

---

## Testing

```bash
cd backend
pytest tests/                   # integration tests hit a fresh SQLite
```

---

## Deployment options

| Target | Notes |
|---|---|
| **Oracle Cloud Always Free** | Recommended for solo/beta. Free forever, real Linux VM, systemd + nginx + certbot. Setup ~2–3 h. |
| **Fly.io** | Great DX but no free tier since Oct 2024 — ~$2–5/mo minimum. Native SQLite via persistent volume. `Dockerfile` is ready to `fly launch`. |
| **Render** | Free tier sleeps + wipes SQLite on deploy — not workable without switching to Postgres. Starter tier ($7/mo) is fine. |
| **ngrok / Cloudflare Tunnel + laptop** | Fastest way to expose a dev backend to a real phone. Not for production — dies with your laptop. |

For any managed host, migrate `DATABASE_URL` to Postgres before crossing
~500 farmers. SQLite is production-grade for beta scale but doesn't like
multi-writer above that.

---

## Common gotchas

- **First boot creates the SQLite schema** via `Base.metadata.create_all`.
  Subsequent boots run the inline auto-migration in `main.py` startup —
  adds new columns via `ALTER TABLE`. If you edit a model, add the
  corresponding `ALTER` block there.
- **CORS is wide open** (`allow_origins=["*"]`) — fine for a mobile-only
  app (the API is called from the RN client, not a browser), but tighten
  before serving a web frontend.
- **`uploads/` directory** is served by `StaticFiles` on `/uploads/`.
  In production, front it with a CDN or move to S3/R2.
- **Alembic exists but isn't the primary migration path yet.** For the
  beta, the auto-migration block in `main.py` handles schema additions.
