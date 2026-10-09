"""
Home-screen data endpoints — market prices (AGMARKNET), weather (OpenWeather),
government subsidies (curated), and irrigation insights.

All endpoints degrade gracefully: when the upstream API is unreachable or a
key is missing, they return sensible fallback data instead of failing, so the
mobile UI always shows something.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
import time
import logging
import threading
from datetime import date as date_cls
from fastapi import APIRouter, Query, Depends, BackgroundTasks
from sqlalchemy.orm import Session

import database
import models

router = APIRouter()
_log = logging.getLogger(__name__)

# Guards concurrent KMV cache refreshes triggered from the API. The scraper
# is polite (5s/req, ~10min full sweep) so we only ever run one at a time.
_kmv_refresh_lock = threading.Lock()
_kmv_refresh_in_progress: set = set()   # commodity names currently refreshing

AGMARKNET_KEY = os.getenv("AGMARKNET_API_KEY", "")
WEATHER_KEY   = os.getenv("WEATHER_API_KEY", "")

# ── Small in-memory cache to avoid hammering upstream APIs ──────────────────
_CACHE: Dict[str, tuple[float, Any]] = {}

def _cache_get(key: str, ttl_s: int) -> Optional[Any]:
    hit = _CACHE.get(key)
    if not hit: return None
    ts, val = hit
    if datetime.utcnow().timestamp() - ts > ttl_s: return None
    return val

def _cache_put(key: str, val: Any) -> None:
    _CACHE[key] = (datetime.utcnow().timestamp(), val)

# ── Karnataka crop → Kannada name (for bilingual UI) ────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# Bilingual + emoji dictionary for every commodity KMV/AGMARKNET can emit.
# Single source of truth — frontend just displays whatever `kn` / `emoji`
# the backend returns. Add a new crop here and both apps pick it up.
#
# Keys are substring-matched against the raw AGMARKNET/KMV commodity string
# (case-insensitive), so "Bhindi(Ladies Finger)" matches "Ladies Finger".
# Order matters: more specific keys first (e.g. "Green Chilly" before "Chilly").
# ─────────────────────────────────────────────────────────────────────────────
CROP_INFO: Dict[str, Dict[str, str]] = {
    # Cereals & millets
    "Paddy":           {"kn": "ಭತ್ತ",             "emoji": "🌾"},
    "Rice":            {"kn": "ಅಕ್ಕಿ",             "emoji": "🍚"},
    "Wheat":           {"kn": "ಗೋಧಿ",             "emoji": "🌾"},
    "Ragi":            {"kn": "ರಾಗಿ",             "emoji": "🌾"},
    "Jowar":           {"kn": "ಜೋಳ",             "emoji": "🌾"},
    "Bajra":           {"kn": "ಸಜ್ಜೆ",             "emoji": "🌾"},
    "Navane":          {"kn": "ನವಣೆ",             "emoji": "🌾"},
    "Maize":           {"kn": "ಮೆಕ್ಕೆಜೋಳ",         "emoji": "🌽"},
    # Pulses & dals
    "Tur Dal":         {"kn": "ತೊಗರಿ ಬೇಳೆ",       "emoji": "🫘"},
    "Tur":             {"kn": "ತೊಗರಿ",           "emoji": "🫘"},
    "Avaredal":        {"kn": "ಅವರೆ ಬೇಳೆ",       "emoji": "🫘"},
    "Avare":           {"kn": "ಅವರೆ",           "emoji": "🫘"},
    "Alasande Gram":   {"kn": "ಅಲಸಂದೆ",           "emoji": "🫘"},
    "Alasandikai":     {"kn": "ಅಲಸಂದೆಕಾಯಿ",     "emoji": "🫛"},
    "Bengal Gramdal":  {"kn": "ಕಡಲೆ ಬೇಳೆ",       "emoji": "🫘"},
    "Bengalgram":      {"kn": "ಕಡಲೆ",           "emoji": "🫘"},
    "Chennangidal":    {"kn": "ಚನ್ನಂಗಿ ಬೇಳೆ",     "emoji": "🫘"},
    "Black Gramdal":   {"kn": "ಉದ್ದಿನ ಬೇಳೆ",     "emoji": "🫘"},
    "Blackgram":       {"kn": "ಉದ್ದು",           "emoji": "🫘"},
    "Green Gramdal":   {"kn": "ಹೆಸರು ಬೇಳೆ",       "emoji": "🫘"},
    "Greengram":       {"kn": "ಹೆಸರು",           "emoji": "🫘"},
    "Horse Gram":      {"kn": "ಹುರುಳಿ",           "emoji": "🫘"},
    "Cowpea (Veg)":    {"kn": "ಅಲಸಂದೆಕಾಯಿ",     "emoji": "🫛"},
    "Cowpea":          {"kn": "ಅಲಸಂದೆ",           "emoji": "🫘"},
    "Moath":           {"kn": "ಮಟಕಿ",           "emoji": "🫘"},
    "Mataki":          {"kn": "ಮಟಕಿ",           "emoji": "🫘"},
    "Peas Wet":        {"kn": "ಬಟಾಣಿ",           "emoji": "🫛"},
    "Green Peas":      {"kn": "ಹಸಿ ಬಟಾಣಿ",       "emoji": "🫛"},
    # Oilseeds
    "Groundnut Seed":  {"kn": "ಶೇಂಗಾ ಬೀಜ",       "emoji": "🥜"},
    "Groundnut":       {"kn": "ಶೇಂಗಾ",           "emoji": "🥜"},
    "Sunflower":       {"kn": "ಸೂರ್ಯಕಾಂತಿ",     "emoji": "🌻"},
    "Safflower":       {"kn": "ಕುಸುಬೆ",           "emoji": "🌻"},
    "Soyabeen":        {"kn": "ಸೋಯಾಬೀನ್",       "emoji": "🫘"},
    "Sesamum":         {"kn": "ಎಳ್ಳು",             "emoji": "⚪"},
    "Gingelly":        {"kn": "ಎಳ್ಳು",             "emoji": "⚪"},
    "Mustard":         {"kn": "ಸಾಸಿವೆ",           "emoji": "🌱"},
    "Castor Seed":     {"kn": "ಔಡಲ ಬೀಜ",         "emoji": "🌰"},
    "Honge Seed":      {"kn": "ಹೊಂಗೆ ಬೀಜ",       "emoji": "🌰"},
    "Neem Seed":       {"kn": "ಬೇವಿನ ಬೀಜ",       "emoji": "🌰"},
    "Gurellu":         {"kn": "ಗುರೆಳ್ಳು",         "emoji": "🌰"},
    "Copra":           {"kn": "ಕೊಬ್ಬರಿ",           "emoji": "🥥"},
    # Vegetables
    "Tomato":          {"kn": "ಟೊಮ್ಯಾಟೊ",         "emoji": "🍅"},
    "Onion":           {"kn": "ಈರುಳ್ಳಿ",           "emoji": "🧅"},
    "Potato":          {"kn": "ಆಲೂಗಡ್ಡೆ",         "emoji": "🥔"},
    "Sweet Potato":    {"kn": "ಗೆಣಸು",             "emoji": "🍠"},
    "Suvarnagadde":    {"kn": "ಸುವರ್ಣಗಡ್ಡೆ",       "emoji": "🍠"},
    "Carrot":          {"kn": "ಗಜ್ಜರಿ",             "emoji": "🥕"},
    "Beetroot":        {"kn": "ಬೀಟ್ರೂಟ್",         "emoji": "🥕"},
    "Raddish":         {"kn": "ಮೂಲಂಗಿ",           "emoji": "🥕"},
    "Cabbage":         {"kn": "ಎಲೆಕೋಸು",         "emoji": "🥬"},
    "Cauliflower":     {"kn": "ಹೂಕೋಸು",           "emoji": "🥦"},
    "Knool Khol":      {"kn": "ಗಡ್ಡೆಕೋಸು",         "emoji": "🥬"},
    "Leafy Vegetables":{"kn": "ಸೊಪ್ಪು",           "emoji": "🥬"},
    "Brinjal":         {"kn": "ಬದನೆಕಾಯಿ",         "emoji": "🍆"},
    "Seemebadanekai":  {"kn": "ಸೀಮೆ ಬದನೆಕಾಯಿ",   "emoji": "🍆"},
    "Chilly Capsicum": {"kn": "ದೊಣ್ಣೆ ಮೆಣಸು",     "emoji": "🫑"},
    "Capsicum":        {"kn": "ದೊಣ್ಣೆ ಮೆಣಸಿನಕಾಯಿ","emoji": "🫑"},
    "Green Chilly":    {"kn": "ಹಸಿ ಮೆಣಸಿನಕಾಯಿ",   "emoji": "🌶️"},
    "Dry Chillies":    {"kn": "ಒಣ ಮೆಣಸಿನಕಾಯಿ",   "emoji": "🌶️"},
    "Ladies Finger":   {"kn": "ಬೆಂಡೆಕಾಯಿ",       "emoji": "🌿"},
    "Cucumbar":        {"kn": "ಸೌತೆಕಾಯಿ",         "emoji": "🥒"},
    "Bitter Gourd":    {"kn": "ಹಾಗಲಕಾಯಿ",         "emoji": "🥒"},
    "Bottle Gourd":    {"kn": "ಸೋರೆಕಾಯಿ",         "emoji": "🥒"},
    "Snakeguard":      {"kn": "ಪಡವಲಕಾಯಿ",       "emoji": "🥒"},
    "Ridgeguard":      {"kn": "ಹೀರೆಕಾಯಿ",         "emoji": "🥒"},
    "Ash Gourd":       {"kn": "ಬೂದುಗುಂಬಳ",       "emoji": "🎃"},
    "White Pumpkin":   {"kn": "ಬಿಳಿ ಗುಂಬಳಕಾಯಿ",   "emoji": "🎃"},
    "Sweet Pumpkin":   {"kn": "ಸಿಹಿ ಗುಂಬಳಕಾಯಿ",   "emoji": "🎃"},
    "Drum Stick":      {"kn": "ನುಗ್ಗೆಕಾಯಿ",         "emoji": "🌿"},
    "Thondekai":       {"kn": "ತೊಂಡೆಕಾಯಿ",       "emoji": "🥒"},
    "Antawala":        {"kn": "ಅಂತವಾಳ",         "emoji": "🌿"},
    "Green Avare (W)": {"kn": "ಹಸಿ ಅವರೆ",         "emoji": "🫛"},
    "Chapparada Avare":{"kn": "ಚಪ್ಪರದ ಅವರೆ",   "emoji": "🫛"},
    "Bunch Beans":     {"kn": "ಗುಚ್ಛ ಬೀನ್ಸ್",     "emoji": "🫛"},
    "Duster Beans":    {"kn": "ಬೀನ್ಸ್",             "emoji": "🫛"},
    "Beans":           {"kn": "ಬೀನ್ಸ್",             "emoji": "🫛"},
    # Spices / condiments
    "Green Ginger":    {"kn": "ಹಸಿ ಶುಂಠಿ",         "emoji": "🫚"},
    "Ginger":          {"kn": "ಶುಂಠಿ",             "emoji": "🫚"},
    "Garlic":          {"kn": "ಬೆಳ್ಳುಳ್ಳಿ",         "emoji": "🧄"},
    "Turmeric":        {"kn": "ಅರಿಶಿನ",             "emoji": "🌿"},
    "Coriander Seed":  {"kn": "ಕೊತ್ತಂಬರಿ ಬೀಜ",     "emoji": "🌿"},
    "Coriander":       {"kn": "ಕೊತ್ತಂಬರಿ ಸೊಪ್ಪು",   "emoji": "🌿"},
    "Methi Seeds":     {"kn": "ಮೆಂತ್ಯ ಬೀಜ",       "emoji": "🌿"},
    "Pepper":          {"kn": "ಕಾಳುಮೆಣಸು",         "emoji": "🌰"},
    "Tamarind Fruit":  {"kn": "ಹುಣಸೆ ಹಣ್ಣು",       "emoji": "🍂"},
    "Tamarind Seed":   {"kn": "ಹುಣಸೆ ಬೀಜ",       "emoji": "🌰"},
    "Betal Leaves":    {"kn": "ವೀಳ್ಯದೆಲೆ",         "emoji": "🌿"},
    "Jaggery":         {"kn": "ಬೆಲ್ಲ",               "emoji": "🍯"},
    # Fruits
    "Banana Green":    {"kn": "ಹಸಿ ಬಾಳೆಹಣ್ಣು",     "emoji": "🍌"},
    "Banana":          {"kn": "ಬಾಳೆಹಣ್ಣು",         "emoji": "🍌"},
    "Mango":           {"kn": "ಮಾವಿನ ಹಣ್ಣು",       "emoji": "🥭"},
    "Grapes":          {"kn": "ದ್ರಾಕ್ಷಿ",             "emoji": "🍇"},
    "Dry Grapes":      {"kn": "ಒಣ ದ್ರಾಕ್ಷಿ",         "emoji": "🍇"},
    "Apple":           {"kn": "ಸೇಬು",               "emoji": "🍎"},
    "Orange":          {"kn": "ಕಿತ್ತಳೆ",             "emoji": "🍊"},
    "Mousambi":        {"kn": "ಮೊಸಂಬಿ",           "emoji": "🍊"},
    "Lime (Lemon)":    {"kn": "ನಿಂಬೆಹಣ್ಣು",         "emoji": "🍋"},
    "Pomagranate":     {"kn": "ದಾಳಿಂಬೆ",           "emoji": "🍎"},
    "Guava":           {"kn": "ಸೀಬೆಕಾಯಿ",         "emoji": "🍈"},
    "Papaya":          {"kn": "ಪಪ್ಪಾಯ",             "emoji": "🥭"},
    "Pine Apple":      {"kn": "ಅನಾನಸ್",             "emoji": "🍍"},
    "Water Melon":     {"kn": "ಕಲ್ಲಂಗಡಿ",           "emoji": "🍉"},
    "Karbuja":         {"kn": "ಕರ್ಬೂಜ",             "emoji": "🍈"},
    "Chikoos (Sapota)":{"kn": "ಸಪೋಟ",               "emoji": "🥝"},
    "Tender Coconut":  {"kn": "ಎಳನೀರು",             "emoji": "🥥"},
    "Coconut (Per 1000)":{"kn": "ತೆಂಗಿನಕಾಯಿ",     "emoji": "🥥"},
    "Other Fruits":    {"kn": "ಇತರ ಹಣ್ಣುಗಳು",       "emoji": "🍒"},
    # Commercial crops
    "Cotton":          {"kn": "ಹತ್ತಿ",               "emoji": "☁️"},
    "Lint":            {"kn": "ಹತ್ತಿ ಎಳೆ",           "emoji": "☁️"},
    "Sugarcane":       {"kn": "ಕಬ್ಬು",               "emoji": "🎋"},
    "Arecanut":        {"kn": "ಅಡಿಕೆ",               "emoji": "🌰"},
    "Cashewnut":       {"kn": "ಗೋಡಂಬಿ",           "emoji": "🌰"},
    "Soapnut":         {"kn": "ಅಂಟುವಾಳ",           "emoji": "🌰"},
    "Coco Brooms":     {"kn": "ತೆಂಗಿನ ಪೊರಕೆ",     "emoji": "🧹"},
    # Flowers
    "All Flowers":     {"kn": "ಎಲ್ಲಾ ಹೂವುಗಳು",     "emoji": "💐"},
    "Rose":            {"kn": "ಗುಲಾಬಿ",             "emoji": "🌹"},
    "Marygold":        {"kn": "ಚೆಂಡುಹೂ",           "emoji": "🌼"},
    "Crysanthamum":    {"kn": "ಸೇವಂತಿಗೆ",         "emoji": "🌼"},
    # Livestock
    "Bull (For Each)":     {"kn": "ಎತ್ತು",         "emoji": "🐂"},
    "Ox (For Each)":       {"kn": "ಹೋರಿ",         "emoji": "🐂"},
    "Cow (For Each)":      {"kn": "ಹಸು",           "emoji": "🐄"},
    "Calf (For Each)":     {"kn": "ಕರು",           "emoji": "🐄"},
    "He Baffalo (For Each)":{"kn": "ಗಂಡು ಎಮ್ಮೆ",   "emoji": "🐃"},
    "She Baffalo (For Each)":{"kn": "ಎಮ್ಮೆ",       "emoji": "🐃"},
    "Goat (For Each)":     {"kn": "ಆಡು",           "emoji": "🐐"},
    "She Goat (For Each)": {"kn": "ಹೆಣ್ಣು ಆಡು",     "emoji": "🐐"},
    "Sheep (For Each)":    {"kn": "ಕುರಿ",           "emoji": "🐑"},
    "Ram (For Each)":      {"kn": "ಟಗರು",         "emoji": "🐏"},
}

def _lookup(crop: str, field: str, default: str) -> str:
    if not crop: return default
    lc = crop.lower()
    for k, v in CROP_INFO.items():
        if k.lower() in lc: return v[field]
    return default

def kn_name(crop: str) -> str:
    """Kannada label for a commodity — falls back to the English name."""
    return _lookup(crop, "kn", crop)

def crop_emoji(crop: str) -> str:
    """Emoji glyph for a commodity — falls back to a generic sprout."""
    return _lookup(crop, "emoji", "🌱")

# ─────────────────────────────────────────────────────────────────────────────
# IMPORTANT: We do NOT ship hardcoded prices. A farming app that shows fake
# numbers as if real breaks the farmer's trust. When AGMARKNET is truly
# unreachable, the API returns an EMPTY prices array + `status: "unavailable"`
# and the mobile UI is required to show an honest "prices unavailable, retry"
# state — never fabricated numbers.
# ─────────────────────────────────────────────────────────────────────────────

# Kannada-name reference list only — used for translating live AGMARKNET
# commodity names, and for the search-modal's "popular crops" hint chips.
POPULAR_CROPS = [
    "Tomato","Onion","Potato","Ragi","Maize","Chili","Green Chilli","Paddy",
    "Rice","Wheat","Cotton","Sugarcane","Groundnut","Brinjal","Carrot",
    "Cabbage","Coconut","Banana","Mango","Grapes","Ginger","Garlic",
    "Turmeric","Coriander","Sunflower","Soyabean","Toor Dal","Jowar","Bajra",
]

# Legacy alias so other code that used to reference the fallback list still
# type-checks; kept empty so any accidental use returns nothing.
_FALLBACK_PRICES: List[Dict[str, Any]] = []

# ── AGMARKNET HTTP settings ────────────────────────────────────────────────
# NOTE: data.gov.in silently blocks/hangs requests without a browser
# User-Agent — the default python-httpx UA gets stuck by their WAF.
# Verified: setting Mozilla UA makes the API respond in <1s vs. timeout.
_HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; KisanShakti/1.0)",
    "Accept": "application/json",
}


def _agmarknet_fetch(params: Dict[str, Any], *, retries: int = 2, timeout: float = 20.0) -> Dict[str, Any]:
    """
    Fetch AGMARKNET with retry-on-timeout. Raises on final failure.
    """
    url = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            with httpx.Client(timeout=timeout, headers=_HTTP_HEADERS) as c:
                r = c.get(url, params=params)
                r.raise_for_status()
                return r.json()
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))     # small back-off
    raise last_err  # type: ignore[misc]



# ── Market prices (AGMARKNET / data.gov.in) ─────────────────────────────────

def _parse_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert raw AGMARKNET rows → app schema, keeping the latest arrival per commodity."""
    grouped: Dict[str, Dict[str, Any]] = {}
    for rec in records:
        crop = (rec.get("commodity") or "").strip()
        if not crop: continue
        try:
            modal = float(rec.get("modal_price") or 0)
            minp  = float(rec.get("min_price") or 0)
            maxp  = float(rec.get("max_price") or 0)
        except (TypeError, ValueError):
            continue
        if modal <= 0: continue

        price_per_kg = round(modal / 100.0, 1)   # ₹/quintal → ₹/kg
        avg = (minp + maxp) / 2 or modal
        change_pct = round(((modal - avg) / avg) * 100, 1)

        key = f"{crop}@{rec.get('market','')}"
        if key not in grouped or rec.get("arrival_date","") > grouped[key].get("_date", ""):
            grouped[key] = {
                "crop":         crop,
                "kn":           kn_name(crop),
                "emoji":        crop_emoji(crop),
                "price":        price_per_kg,
                "change":       change_pct,
                "market":       rec.get("market", ""),
                "district":     rec.get("district", ""),
                "variety":      rec.get("variety", ""),
                "arrival_date": rec.get("arrival_date", ""),
                "unit":         "kg",
                "_date":        rec.get("arrival_date", ""),
            }
    out = list(grouped.values())
    for p in out: p.pop("_date", None)
    return out


@router.get("/api/v1/market/popular-crops")
def popular_crops():
    """Static list of crop-name suggestions for the search UI."""
    return {"crops": POPULAR_CROPS}


@router.get("/api/v1/market/districts")
def market_districts(state: Optional[str] = Query(None)):
    """
    Return the district/APMC hierarchy for one state (or all states if
    `state` is omitted). Feeds the search-screen dropdowns.

    Source: static coordinate table in data/apmc_locations.py — no
    upstream call, always fast. Extend that file to add markets.

    Shape:
      {
        "states": [
          {
            "name": "Karnataka",
            "districts": [
              { "name": "Kolar", "apmcs": ["Kolar", "Bangarpet", ...] },
              ...
            ]
          },
          ...
        ]
      }
    """
    from data.apmc_locations import APMC_LOCATIONS

    grouped: Dict[str, Dict[str, List[str]]] = {}
    seen_market_key: set = set()
    for norm_key, entry in APMC_LOCATIONS.items():
        # Dedupe alias keys (e.g. "kolar" + "kollar" both point to the same APMC).
        # Two entries with identical (state, district, lat, lon) are aliases —
        # keep only the first pretty name we generated for each APMC.
        sig = (entry["state"], entry["district"], round(entry["lat"], 4), round(entry["lon"], 4))
        if sig in seen_market_key:
            continue
        seen_market_key.add(sig)
        # Pretty market name from the normalized key (title-case, keep as-is
        # for known acronyms). Callers can override display formatting.
        pretty = norm_key.replace("_", " ").title()
        st = entry["state"]
        dt = entry["district"]
        grouped.setdefault(st, {}).setdefault(dt, []).append(pretty)

    states = []
    for st in sorted(grouped.keys()):
        districts = []
        for dt in sorted(grouped[st].keys()):
            districts.append({
                "name":  dt,
                "apmcs": sorted(grouped[st][dt]),
            })
        states.append({"name": st, "districts": districts})

    if state:
        states = [s for s in states if s["name"].lower() == state.strip().lower()]

    return {"states": states}


@router.get("/api/v1/market/prices")
def market_prices(
    state: str = Query("Karnataka"),
    district: Optional[str] = Query(None, description="e.g. Kolar, Bengaluru"),
    market: Optional[str] = Query(None, description="Specific mandi, e.g. Kolar, Malur"),
    commodity: Optional[str] = Query(None, description="Crop-name search (partial ok)"),
    limit: int = Query(50, ge=1, le=200),
    source: str = Query("kmv", pattern="^(kmv|data_gov)$",
                        description="'kmv' (default): Karnataka state portal (accurate for KA). "
                                    "'data_gov': national AGMARKNET (broader, less KA coverage)."),
    lat: Optional[float] = Query(None, description="Farmer GPS lat — rows ranked by distance"),
    lon: Optional[float] = Query(None, description="Farmer GPS lon — rows ranked by distance"),
    scope: str = Query("nearest", pattern="^(nearest|state|all_india)$",
                       description="'nearest' (default): top-20 APMCs within 300km of (lat,lon). "
                                   "'state': all markets in this state. "
                                   "'all_india': entire data.gov.in feed."),
    background: BackgroundTasks = None,          # type: ignore[assignment]
    db: Session = Depends(database.get_db),
):
    """
    Live daily mandi prices.

    Default source is **KMV** (Karnataka's Krishi Marata Vahini) — covers
    ~all 162 Karnataka APMCs including Kolar/Bangarpet/Chintamani/Srinivaspur
    that data.gov.in's AGMARKNET mirror routinely misses.

    Set `source=data_gov` to fetch the national AGMARKNET feed instead
    (used by the search screen's "Show all" toggle).

    When `source=kmv` and Karnataka has nothing for the query, we silently
    fall through to `source=data_gov` (still Karnataka-scoped) and label the
    payload's `source` accordingly — the farmer always sees a truthful
    "which system provided this number" tag.

    On both-empty, returns `status: "unavailable"` + empty prices. NEVER
    fabricates numbers (per the app's core no-hardcoded-farmer-data rule).
    """
    # Scope rules:
    #   nearest  → let source decide, then rank by proximity + cap at 300km/20
    #   state    → source-specific, whole state, no proximity filter
    #   all_india→ force data.gov.in, national, no proximity filter
    if scope == "all_india":
        source = "data_gov"

    # If district was supplied as state name or generic filter, normalize to None
    if district and district.strip().lower() in {"karnataka", "india", "all", "state"}:
        district = None

    if source == "kmv" and (state or "").strip().lower() == "karnataka":
        payload = _serve_kmv_prices(
            db=db, background=background, state=state, district=district,
            market=market, commodity=commodity,
            # Pull a wider candidate set when we'll re-rank by proximity;
            # the ranker itself trims to top-20 for 'nearest' scope.
            limit=max(limit, 200) if scope == "nearest" else limit,
        )
    else:
        payload = _serve_data_gov_prices(
            state=state, district=district, market=market,
            commodity=commodity,
            limit=max(limit, 200) if scope == "nearest" else limit,
        )

    # Attach distance + rank when a GPS point is available (default scope).
    if scope == "nearest" and payload.get("prices"):
        from price.proximity import annotate_and_rank
        ranked, prox_note = annotate_and_rank(
            payload["prices"], lat, lon, limit=limit,
        )
        payload["prices"] = ranked
        payload["count"]  = len(ranked)
        if prox_note:
            existing = payload.get("note")
            payload["note"] = f"{existing} · {prox_note}" if existing else prox_note
    elif payload.get("prices"):
        # Still enrich district/market_state so the card can label the source,
        # just don't re-sort or cap.
        from price.proximity import annotate_and_rank
        payload["prices"], _ = annotate_and_rank(
            payload["prices"], lat, lon,
            limit=limit, nearest_only=False,
        )
    return payload


def _serve_data_gov_prices(
    *, state: str, district: Optional[str], market: Optional[str],
    commodity: Optional[str], limit: int,
) -> Dict[str, Any]:
    cache_key = f"market:data_gov:{state}:{district or ''}:{market or ''}:{commodity or ''}:{limit}"
    cached = _cache_get(cache_key, ttl_s=1800)   # 30 min
    if cached is not None:
        return cached

    def _q_match(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not commodity: return rows
        q = commodity.strip().lower()
        return [r for r in rows if q in r["crop"].lower() or q in (r.get("kn") or "")]

    def _unavailable(reason: str, hint: str) -> Dict[str, Any]:
        return {
            "status":    "unavailable",
            "source":    "agmarknet",
            "state":     state, "district": district,
            "market":    market, "commodity": commodity,
            "count":     0, "prices": [],
            "reason":    reason,
            "hint":      hint,
        }

    if not AGMARKNET_KEY:
        return _unavailable(
            "Market data service is not configured on the server.",
            "Contact support — the AGMARKNET API key is missing.",
        )

    # 1) Try the narrow query (state + district + market as given).
    params: Dict[str, Any] = {
        "api-key": AGMARKNET_KEY, "format": "json",
        "limit":  max(limit * 4, 500),
        "filters[state]": state,
    }
    if district: params["filters[district]"] = district
    if market:   params["filters[market]"]   = market

    try:
        data = _agmarknet_fetch(params)
    except Exception as e:
        return _unavailable(
            f"AGMARKNET is not reachable right now ({type(e).__name__}).",
            "This usually clears within an hour. Pull to refresh, or try again later.",
        )

    rows_all  = _parse_records(data.get("records", []) or [])
    rows_kept = _q_match(rows_all)[:limit]
    note: Optional[str] = None

    # 2) If a district/market filter hit zero, widen to statewide and note it.
    if not rows_kept and (district or market):
        try:
            wide_data = _agmarknet_fetch({
                "api-key": AGMARKNET_KEY, "format": "json",
                "limit": 500, "filters[state]": state,
            })
            wide_all  = _parse_records(wide_data.get("records", []) or [])
            rows_kept = _q_match(wide_all)[:limit]
            if rows_kept:
                note = f"No records for {market or district} today — showing all {state}"
        except Exception:
            pass   # will fall through to unavailable below

    # 3) Genuine "no data" — no fabrication, honest empty state.
    if not rows_kept:
        return _unavailable(
            f"No mandi has reported {commodity or 'crop'} prices in {market or district or state} today.",
            "Mandis update after their day's trade closes (typically 4–7 PM IST). Check again later.",
        )

    payload = {
        "status":     "ok",
        "source":     "agmarknet",
        "state":      state,
        "district":   district,
        "market":     market,
        "commodity":  commodity,
        "count":      len(rows_kept),
        "note":       note,
        "prices":     rows_kept,
    }
    _cache_put(cache_key, payload)
    return payload


# ── KMV (Krishi Marata Vahini — Karnataka state APMC portal) ───────────────

# When cache is older than this, we kick off an on-demand refresh in the
# background. The current request still returns whatever cache has (may be
# empty on cold start) — keeps first-load snappy, next request is fresh.
_KMV_STALE_HOURS = 6


def _stale_kick(background: Optional[BackgroundTasks], commodity: Optional[str]) -> None:
    """
    Fire-and-forget KMV refresh. Guarded by an in-memory set so we don't
    fan out N parallel scrapers if 100 users hit the same crop simultaneously.
    """
    if background is None:
        return
    target = (commodity or "").strip().lower() or "__snapshot__"
    with _kmv_refresh_lock:
        if target in _kmv_refresh_in_progress:
            return
        _kmv_refresh_in_progress.add(target)

    def _run() -> None:
        from sources import kmv_cache
        db = database.SessionLocal()
        try:
            if commodity:
                kmv_cache.refresh_commodity(db, commodity)
            else:
                # Full snapshot: only via explicit cron, not from here — too slow.
                pass
        except Exception as e:
            _log.warning("[kmv] background refresh failed: %s", e)
        finally:
            db.close()
            with _kmv_refresh_lock:
                _kmv_refresh_in_progress.discard(target)

    background.add_task(_run)


def _kmv_row_to_payload(row: models.KmvPriceCache) -> Dict[str, Any]:
    """Match the schema produced by _parse_records() so the app renders identically."""
    modal  = float(row.modal_price_kg or 0)
    minp   = float(row.min_price_kg   or 0)
    maxp   = float(row.max_price_kg   or 0)
    avg    = (minp + maxp) / 2 or modal
    change = round(((modal - avg) / avg) * 100, 1) if avg else 0.0
    crop   = row.commodity or ""
    return {
        "crop":         crop,
        "kn":           kn_name(crop),
        "emoji":        crop_emoji(crop),
        "price":        round(modal, 1),
        "change":       change,
        "market":       (row.market or "").title(),
        "district":     row.district or "",
        "variety":      row.variety or "",
        "arrival_date": row.arrival_date.strftime("%d/%m/%Y") if row.arrival_date else "",
        "unit":         "kg",
    }


def _serve_kmv_prices(
    *, db: Session, background: Optional[BackgroundTasks],
    state: str, district: Optional[str], market: Optional[str],
    commodity: Optional[str], limit: int,
) -> Dict[str, Any]:
    """
    Read from kmv_price_cache. Silently falls through to data.gov.in
    (still Karnataka-scoped) if KMV has nothing — the response's `source`
    field always tells the app which system provided the numbers.
    """
    # Ensure baseline is seeded if database cache is completely empty
    if db.query(models.KmvPriceCache.id).first() is None:
        try:
            from sources import kmv_cache
            kmv_cache.seed_cache_if_empty(db)
        except Exception:
            pass

    base = db.query(models.KmvPriceCache)
    if commodity:
        base = base.filter(models.KmvPriceCache.commodity.ilike(f"%{commodity.strip()}%"))
    if market:
        base = base.filter(models.KmvPriceCache.market.ilike(f"%{market.strip()}%"))

    # District filter: use the authoritative APMC-location map instead of
    # substring matching. For district="Kolar" this expands to markets
    # {KOLAR, BANGARPET, CHINTAMANI, SRINIVASPUR, MALUR, MULBAGAL}.
    #
    # If the incoming string isn't a KNOWN district (common when the
    # farmer's profile stores a market name like "Bangarpet" as their
    # "district"), we ALSO try matching it as a market name so that the
    # farmer's actual APMC's parent-district's markets are pulled in. This
    # prevents the "only drumstick appears" bug: previously an unknown-
    # district string fell into a substring-market match that would pull
    # just one APMC — thin, misleading data.
    q = base
    district_note: Optional[str] = None
    if district and not market:
        from data.apmc_locations import APMC_LOCATIONS, lookup as _lookup_apmc
        dl = district.strip().lower()

        # (a) Direct district match — the good path.
        market_keys = {
            k for k, v in APMC_LOCATIONS.items()
            if v["district"].strip().lower() == dl
        }

        # (b) If direct match failed, treat the string as a MARKET name and
        # resolve it to its parent district, then expand from there.
        if not market_keys:
            asset = _lookup_apmc(district)
            if asset:
                parent_district = asset["district"].strip().lower()
                market_keys = {
                    k for k, v in APMC_LOCATIONS.items()
                    if v["district"].strip().lower() == parent_district
                }
                district_note = (
                    f"'{district}' looks like a market, not a district — "
                    f"showing all markets in {asset['district']}"
                )

        if market_keys:
            from sqlalchemy import or_, func as sql_func
            preds = [
                sql_func.replace(
                    sql_func.replace(
                        sql_func.lower(models.KmvPriceCache.market),
                        ' ', ''
                    ), '.', ''
                ).like(f"%{k}%")
                for k in market_keys
            ]
            q = q.filter(or_(*preds))
        # else: fall through with no district filter — proximity ranker
        # (annotate_and_rank in the caller) will cut it back to the closest
        # 20 within 300 km, which is the correct behaviour when we can't
        # trust the district label at all.

    q = q.order_by(models.KmvPriceCache.arrival_date.desc()).limit(max(limit * 4, 400))
    rows = q.all()
    # Sparse-cache safety: even a known district can occasionally have
    # fewer than a screen's worth of fresh rows (early morning refresh,
    # commodity gaps). Widen to statewide so the farmer sees something
    # useful rather than a near-empty screen; proximity ranking still
    # keeps the local ones on top.
    SPARSE_ROW_THRESHOLD = 15
    if district and not market and len(rows) < SPARSE_ROW_THRESHOLD:
        rows = (
            base.order_by(models.KmvPriceCache.arrival_date.desc())
                .limit(max(limit * 4, 400)).all()
        )
        if not district_note:
            district_note = f"Thin cache for {district} — showing statewide"

    # Freshness watchdog: if the newest row for the query is >6h old, kick
    # off a background refresh so the next request is current.
    if rows:
        newest = max(r.fetched_at for r in rows if r.fetched_at)
        if newest and (datetime.utcnow() - newest) > timedelta(hours=_KMV_STALE_HOURS):
            _stale_kick(background, commodity)
    else:
        # Cold cache for this commodity → kick refresh, then fall through to
        # data.gov.in so the user isn't staring at an empty screen.
        _stale_kick(background, commodity)

    # Dedupe: keep newest arrival_date per (market, commodity, variety)
    seen: Dict[str, models.KmvPriceCache] = {}
    for r in rows:
        key = f"{r.market}|{r.commodity}|{r.variety or ''}"
        prev = seen.get(key)
        if prev is None or (r.arrival_date and (not prev.arrival_date or r.arrival_date > prev.arrival_date)):
            seen[key] = r
    picks = list(seen.values())[:limit]
    payload_rows = [_kmv_row_to_payload(r) for r in picks]

    if payload_rows:
        return {
            "status":    "ok",
            "source":    "kmv",
            "state":     state, "district": district,
            "market":    market, "commodity": commodity,
            "count":     len(payload_rows),
            "note":      district_note,
            "prices":    payload_rows,
        }

    # Empty KMV → transparent fall-through to national AGMARKNET (still KA)
    fallback = _serve_data_gov_prices(
        state=state, district=district, market=market,
        commodity=commodity, limit=limit,
    )
    if fallback.get("prices"):
        fallback["note"] = "KMV had no data for this query — showing data.gov.in fallback"
    return fallback


# ── Weather (OpenWeather 2.5 current + one-call fallback) ───────────────────

@router.get("/api/v1/weather/current")
def weather_current(
    lat: float = Query(13.1367),
    lon: float = Query(78.1325),
):
    """
    Current weather + 24 h alerts summary. Falls back to a stub when
    the API key is missing or upstream fails.
    """
    cache_key = f"weather:{lat:.3f}:{lon:.3f}"
    cached = _cache_get(cache_key, ttl_s=600)  # 10 min
    if cached is not None:
        return cached

    if not WEATHER_KEY:
        stub = _weather_stub(lat, lon)
        _cache_put(cache_key, stub)
        return stub

    try:
        with httpx.Client(timeout=6.0) as c:
            r = c.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"lat": lat, "lon": lon, "appid": WEATHER_KEY, "units": "metric"},
            )
            r.raise_for_status()
            cur = r.json()

            fc = c.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={"lat": lat, "lon": lon, "appid": WEATHER_KEY, "units": "metric", "cnt": 8},
            )
            forecast = fc.json() if fc.status_code == 200 else {"list": []}
    except Exception as e:
        stub = _weather_stub(lat, lon)
        stub["error"] = str(e)
        _cache_put(cache_key, stub)
        return stub

    main   = cur.get("main", {})
    wx     = (cur.get("weather") or [{}])[0]
    condition = wx.get("main", "Clear")

    # Build a 24h alert only when precipitation is *likely* — not just
    # tagged. OpenWeather labels stray drizzles as "Rain" with 10% pop,
    # which caused false alerts vs. what a phone weather app shows.
    # Rules: Thunderstorm/Snow/Extreme always alert; Rain only when
    # probability ≥ 60% AND expected volume ≥ 1 mm/3h.
    alert: Optional[Dict[str, Any]] = None
    for slot in forecast.get("list", []):
        s_wx = (slot.get("weather") or [{}])[0].get("main", "")
        s_tm = slot.get("dt_txt", "")
        temp = slot.get("main", {}).get("temp", 0)
        pop  = float(slot.get("pop", 0) or 0)              # 0-1 probability
        rain_mm = float((slot.get("rain") or {}).get("3h", 0) or 0)

        if s_wx in ("Thunderstorm", "Snow", "Extreme"):
            alert = {
                "severity": "warning", "title": f"{s_wx} expected",
                "title_kn": {"Thunderstorm": "ಗುಡುಗು-ಮಿಂಚು ಮಳೆ",
                             "Snow": "ಹಿಮಪಾತ", "Extreme": "ತೀವ್ರ ಹವಾಮಾನ"}.get(s_wx, ""),
                "message":  f"{s_wx} expected around {s_tm} UTC. Plan farm activities accordingly.",
                "when":     s_tm, "pop": round(pop * 100), "rain_mm": rain_mm,
            }
            break
        if s_wx == "Rain" and pop >= 0.6 and rain_mm >= 1.0:
            alert = {
                "severity": "warning", "title": "Rain expected",
                "title_kn": "ಮಳೆ ನಿರೀಕ್ಷೆ",
                "message":  f"Rain likely ({int(pop*100)}% chance, ~{rain_mm:.1f} mm) around {s_tm} UTC.",
                "when":     s_tm, "pop": round(pop * 100), "rain_mm": rain_mm,
            }
            break
        if temp >= 40:
            alert = {
                "severity": "warning", "title": "Heatwave expected",
                "title_kn": "ಬಿಸಿಗಾಳಿ ನಿರೀಕ್ಷೆ",
                "message":  f"High of {temp:.0f}°C at {s_tm}. Irrigate early morning.",
                "when":     s_tm, "pop": round(pop * 100), "rain_mm": 0,
            }
            break

    payload = {
        "source":     "openweather",
        "location":   cur.get("name", ""),
        "temp_c":     round(main.get("temp", 0), 1),
        "feels_like": round(main.get("feels_like", 0), 1),
        "humidity":   main.get("humidity", 0),
        "wind_kmh":   round(cur.get("wind", {}).get("speed", 0) * 3.6, 1),
        "condition":  condition,
        "condition_kn": {"Clear":"ಸ್ವಚ್ಛ","Clouds":"ಮೋಡ","Rain":"ಮಳೆ",
                          "Thunderstorm":"ಗುಡುಗು","Drizzle":"ತುಂತುರು",
                          "Haze":"ಮಂಜು","Mist":"ಮಂಜು"}.get(condition, condition),
        "icon":       wx.get("icon", "01d"),
        "spray_ok":   condition in ("Clear","Clouds"),
        "alert":      alert,
    }
    _cache_put(cache_key, payload)
    return payload


def _weather_stub(lat: float, lon: float) -> Dict[str, Any]:
    return {
        "source": "stub",
        "location": "Kolar",
        "temp_c": 28.0, "feels_like": 30.0, "humidity": 62,
        "wind_kmh": 8.0, "condition": "Clear", "condition_kn": "ಸ್ವಚ್ಛ",
        "icon": "01d", "spray_ok": True, "alert": None,
    }

# ── 7-Day Forecast (Open-Meteo — free, no key required) ────────────────────

# WMO weather-code → app icon kind + English/Kannada label.
# https://open-meteo.com/en/docs (weather_code table)
def _wmo_kind(code: int) -> Dict[str, str]:
    if code == 0:                          return {"kind": "sunny",   "en": "Clear",         "kn": "ಸ್ವಚ್ಛ"}
    if code in (1, 2):                     return {"kind": "partly",  "en": "Partly cloudy", "kn": "ಭಾಗಶಃ ಮೋಡ"}
    if code == 3:                          return {"kind": "cloudy",  "en": "Cloudy",        "kn": "ಮೋಡ"}
    if code in (45, 48):                   return {"kind": "cloudy",  "en": "Fog",           "kn": "ಮಂಜು"}
    if code in (51, 53, 55, 56, 57):       return {"kind": "rain",    "en": "Drizzle",       "kn": "ತುಂತುರು"}
    if code in (61, 63, 65, 66, 67,
                80, 81, 82):               return {"kind": "rain",    "en": "Rain",          "kn": "ಮಳೆ"}
    if code in (71, 73, 75, 77, 85, 86):   return {"kind": "cloudy",  "en": "Snow",          "kn": "ಹಿಮ"}
    if code in (95, 96, 99):               return {"kind": "thunder", "en": "Thunderstorm",  "kn": "ಗುಡುಗು"}
    return {"kind": "partly", "en": "—", "kn": "—"}


# OpenWeather condition (`weather[0].main`) → app icon kind + KN label.
def _ow_kind(main: str) -> Dict[str, str]:
    m = (main or "").strip()
    if m == "Clear":         return {"kind": "sunny",   "en": "Clear",         "kn": "ಸ್ವಚ್ಛ"}
    if m == "Clouds":        return {"kind": "partly",  "en": "Partly cloudy", "kn": "ಭಾಗಶಃ ಮೋಡ"}
    if m in ("Mist", "Haze", "Fog", "Smoke", "Dust", "Sand"):
        return {"kind": "cloudy",  "en": m,               "kn": "ಮಂಜು"}
    if m in ("Rain", "Drizzle"):
        return {"kind": "rain",    "en": m,               "kn": "ಮಳೆ"}
    if m in ("Snow",):
        return {"kind": "cloudy",  "en": "Snow",          "kn": "ಹಿಮ"}
    if m == "Thunderstorm":  return {"kind": "thunder", "en": "Thunderstorm",  "kn": "ಗುಡುಗು"}
    return {"kind": "partly", "en": m or "—", "kn": "—"}


def _forecast_open_meteo(lat: float, lon: float, days: int) -> Dict[str, Any]:
    """Keyless fallback using Open-Meteo."""
    day_labels_en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    day_labels_kn = ["ಭಾನು", "ಸೋಮ", "ಮಂಗಳ", "ಬುಧ", "ಗುರು", "ಶುಕ್ರ", "ಶನಿ"]
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude":  lat, "longitude": lon,
                    "daily":     "weather_code,temperature_2m_max,temperature_2m_min,"
                                 "precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
                    "hourly":    "precipitation_probability,precipitation",
                    "timezone":  "auto",
                    "forecast_days": days,
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        return {"status":"unavailable","source":"open-meteo","error":str(e),
                "days":[],"next_24h_rain_pct":None,"next_24h_rain_mm":None}

    daily = data.get("daily", {}) or {}
    times = daily.get("time", []) or []
    codes = daily.get("weather_code", []) or []
    highs = daily.get("temperature_2m_max", []) or []
    lows  = daily.get("temperature_2m_min", []) or []
    pops  = daily.get("precipitation_probability_max", []) or []
    sums  = daily.get("precipitation_sum", []) or []
    winds = daily.get("wind_speed_10m_max", []) or []

    out: List[Dict[str, Any]] = []
    for i, iso in enumerate(times[:days]):
        try:
            idx = (datetime.fromisoformat(iso).date().weekday() + 1) % 7
        except Exception:
            idx = 0
        wmo = _wmo_kind(int(codes[i]) if i < len(codes) and codes[i] is not None else -1)
        out.append({
            "date": iso,
            "day_en": "Today" if i == 0 else day_labels_en[idx],
            "day_kn": "ಇಂದು"   if i == 0 else day_labels_kn[idx],
            "high_c": round(float(highs[i]), 1) if i < len(highs) and highs[i] is not None else None,
            "low_c":  round(float(lows[i]),  1) if i < len(lows)  and lows[i]  is not None else None,
            "rain_pct": int(pops[i]) if i < len(pops) and pops[i] is not None else 0,
            "rain_mm":  round(float(sums[i]), 1) if i < len(sums) and sums[i] is not None else 0.0,
            "wind_kmh": round(float(winds[i]), 1) if i < len(winds) and winds[i] is not None else 0.0,
            "kind": wmo["kind"], "condition": wmo["en"], "condition_kn": wmo["kn"],
        })

    hourly = data.get("hourly", {}) or {}
    h_pops = hourly.get("precipitation_probability", []) or []
    h_mm   = hourly.get("precipitation", []) or []
    return {
        "status": "ok", "source": "open-meteo",
        "location": {"lat": lat, "lon": lon},
        "days": out,
        "next_24h_rain_pct": max(h_pops[:24]) if h_pops else None,
        "next_24h_rain_mm":  round(sum(x for x in h_mm[:24] if x is not None), 1) if h_mm else None,
    }


def _forecast_openweather(lat: float, lon: float, days: int) -> Optional[Dict[str, Any]]:
    """
    Preferred path — OpenWeather 5-day / 3-hour forecast, aggregated to
    daily buckets. Returns None if the API key is missing or upstream
    fails, so caller can fall back to Open-Meteo.
    """
    if not WEATHER_KEY:
        return None
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={"lat": lat, "lon": lon, "appid": WEATHER_KEY, "units": "metric"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"[weather_forecast] OpenWeather error: {e}")
        return None

    day_labels_en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    day_labels_kn = ["ಭಾನು", "ಸೋಮ", "ಮಂಗಳ", "ಬುಧ", "ಗುರು", "ಶುಕ್ರ", "ಶನಿ"]

    # Aggregate 3-hour slots into daily buckets keyed by local date.
    from collections import defaultdict, Counter
    buckets: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "temps": [], "pops": [], "rain_mm": 0.0, "winds": [], "mains": [],
    })
    tz_off = int(data.get("city", {}).get("timezone", 0) or 0)  # seconds

    for slot in data.get("list", []) or []:
        dt = int(slot.get("dt", 0))
        local = datetime.utcfromtimestamp(dt + tz_off).date().isoformat()
        b = buckets[local]
        main = slot.get("main", {}) or {}
        wx   = (slot.get("weather") or [{}])[0]
        b["temps"].append(float(main.get("temp", 0)))
        b["pops"].append(float(slot.get("pop", 0) or 0))
        b["rain_mm"] += float((slot.get("rain") or {}).get("3h", 0) or 0)
        b["winds"].append(float((slot.get("wind") or {}).get("speed", 0) or 0))
        b["mains"].append(wx.get("main", "Clear"))

    # Also compute next-24h rain from the first ~8 slots (=24 h).
    first_8 = (data.get("list") or [])[:8]
    next24_pct = int(round(max((float(s.get("pop", 0) or 0) for s in first_8), default=0.0) * 100)) if first_8 else None
    next24_mm  = round(sum(float((s.get("rain") or {}).get("3h", 0) or 0) for s in first_8), 1) if first_8 else None

    out: List[Dict[str, Any]] = []
    for i, (iso, b) in enumerate(sorted(buckets.items())[:days]):
        try:
            idx = (datetime.fromisoformat(iso).weekday() + 1) % 7
        except Exception:
            idx = 0
        dominant = Counter(b["mains"]).most_common(1)[0][0] if b["mains"] else "Clear"
        kind = _ow_kind(dominant)
        out.append({
            "date":     iso,
            "day_en":   "Today" if i == 0 else day_labels_en[idx],
            "day_kn":   "ಇಂದು"   if i == 0 else day_labels_kn[idx],
            "high_c":   round(max(b["temps"]), 1) if b["temps"] else None,
            "low_c":    round(min(b["temps"]), 1) if b["temps"] else None,
            "rain_pct": int(round((max(b["pops"]) if b["pops"] else 0) * 100)),
            "rain_mm":  round(b["rain_mm"], 1),
            "wind_kmh": round((max(b["winds"]) if b["winds"] else 0) * 3.6, 1),
            "kind":     kind["kind"],
            "condition": kind["en"],
            "condition_kn": kind["kn"],
        })

    return {
        "status": "ok", "source": "openweather",
        "location": {"lat": lat, "lon": lon},
        "days": out,
        "next_24h_rain_pct": next24_pct,
        "next_24h_rain_mm":  next24_mm,
    }


@router.get("/api/v1/weather/forecast")
def weather_forecast(
    lat: float = Query(13.1367),
    lon: float = Query(78.1325),
    days: int  = Query(7, ge=1, le=14),
):
    """
    Daily forecast + next-24h rain probability + live current condition.
    Primary source: OpenWeather (uses WEATHER_API_KEY).
    Fallback:       Open-Meteo (no key).

    The `current` block lets the client override "Today" with the actual
    right-now condition — a farmer standing in the rain doesn't care that
    the day's *average* forecast is "partly cloudy".
    """
    cache_key = f"forecast:{lat:.3f}:{lon:.3f}:{days}"
    cached = _cache_get(cache_key, ttl_s=600)   # 10 min (was 30 min — too stale for rain events)
    if cached is not None:
        return cached

    result = _forecast_openweather(lat, lon, days)
    if not (result and result.get("days")):
        result = _forecast_open_meteo(lat, lon, days)

    # Attach live current condition so the client can render Today accurately.
    try:
        cur = weather_current(lat=lat, lon=lon)
        cur_kind = _ow_kind(cur.get("condition", "Clear"))
        result["current"] = {
            "temp_c":       cur.get("temp_c"),
            "humidity":     cur.get("humidity"),
            "wind_kmh":     cur.get("wind_kmh"),
            "condition":    cur.get("condition"),
            "condition_kn": cur.get("condition_kn"),
            "kind":         cur_kind["kind"],
        }
    except Exception as e:
        result["current"] = None
        result["current_error"] = str(e)

    _cache_put(cache_key, result)
    return result


@router.get("/api/v1/weather/rain-diary")
def weather_rain_diary(
    lat: float = Query(13.1367),
    lon: float = Query(78.1325),
    past:   int = Query(7,  ge=0, le=30),
    future: int = Query(7,  ge=0, le=14),
):
    """
    Past + future daily precipitation totals (mm) for the "rain diary"
    strip on the Weather tab. Used to answer "how much rain has the field
    already gotten this week, and how much more is coming?".

    Purely Open-Meteo (their `past_days` parameter is free + keyless).
    Cached 30 min because past-day totals only change once a day and the
    upcoming days share the same cache TTL as the main forecast.
    """
    day_labels_en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    day_labels_kn = ["ಭಾನು", "ಸೋಮ", "ಮಂಗಳ", "ಬುಧ", "ಗುರು", "ಶುಕ್ರ", "ಶನಿ"]

    cache_key = f"rain-diary:{lat:.3f}:{lon:.3f}:{past}:{future}"
    cached = _cache_get(cache_key, ttl_s=1800)
    if cached is not None:
        return cached

    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lon,
                    "daily":    "precipitation_sum",
                    "past_days":     past,
                    "forecast_days": future,
                    "timezone": "auto",
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        return {"status": "unavailable", "source": "open-meteo",
                "error": str(e), "days": [], "past_total_mm": None, "future_total_mm": None}

    daily = data.get("daily", {}) or {}
    times = daily.get("time", []) or []
    sums  = daily.get("precipitation_sum", []) or []
    today = datetime.utcnow().date().isoformat()

    days_out: List[Dict[str, Any]] = []
    past_mm = 0.0
    future_mm = 0.0
    for i, iso in enumerate(times):
        try:
            date_obj = datetime.fromisoformat(iso).date()
            idx = (date_obj.weekday() + 1) % 7
        except Exception:
            date_obj, idx = None, 0
        mm = round(float(sums[i]), 1) if i < len(sums) and sums[i] is not None else 0.0
        is_past = date_obj is not None and iso < today
        is_today = iso == today
        if is_past:  past_mm   += mm
        else:        future_mm += mm
        days_out.append({
            "date":    iso,
            "day_en":  "Today" if is_today else day_labels_en[idx],
            "day_kn":  "ಇಂದು" if is_today else day_labels_kn[idx],
            "rain_mm": mm,
            "is_past": is_past,
            "is_today": is_today,
        })

    result = {
        "status": "ok", "source": "open-meteo",
        "location": {"lat": lat, "lon": lon},
        "days": days_out,
        "past_total_mm":   round(past_mm, 1),
        "future_total_mm": round(future_mm, 1),
    }
    _cache_put(cache_key, result)
    return result


# ── Government subsidies (curated feed) ─────────────────────────────────────

_SUBSIDIES = [
    {
        "id": "pmkisan-2025",
        "title": "PM-Kisan Samman Nidhi",
        "title_kn": "ಪಿಎಂ-ಕಿಸಾನ್ ಸಮ್ಮಾನ್ ನಿಧಿ",
        "amount_inr": 6000,
        "description": "₹6,000/year direct benefit to eligible farmer families in 3 instalments.",
        "eligibility": "All landholding farmer families",
        "apply_url": "https://pmkisan.gov.in/",
        "state": "All India",
        "deadline": "2026-03-31",
    },
    {
        "id": "raita-vidya-nidhi",
        "title": "Raita Vidya Nidhi Scholarship",
        "title_kn": "ರೈತ ವಿದ್ಯಾ ನಿಧಿ ವಿದ್ಯಾರ್ಥಿವೇತನ",
        "amount_inr": 11000,
        "description": "Scholarship for children of Karnataka farmers pursuing higher studies.",
        "eligibility": "Farmers' children in Karnataka",
        "apply_url": "https://raitamitra.karnataka.gov.in/",
        "state": "Karnataka",
        "deadline": "2026-12-31",
    },
    {
        "id": "krishi-bhagya-drip",
        "title": "Krishi Bhagya — Drip Irrigation Subsidy",
        "title_kn": "ಕೃಷಿ ಭಾಗ್ಯ — ಹನಿ ನೀರಾವರಿ ಸಬ್ಸಿಡಿ",
        "amount_inr": 90000,
        "description": "Up to 90% subsidy on drip / sprinkler irrigation for dryland farmers.",
        "eligibility": "Small & marginal farmers",
        "apply_url": "https://raitamitra.karnataka.gov.in/",
        "state": "Karnataka",
        "deadline": "2026-06-30",
    },
    {
        "id": "kcc-2025",
        "title": "Kisan Credit Card (KCC) — 4% interest",
        "title_kn": "ಕಿಸಾನ್ ಕ್ರೆಡಿಟ್ ಕಾರ್ಡ್",
        "amount_inr": 300000,
        "description": "Short-term crop loans up to ₹3 lakh at 4% effective interest.",
        "eligibility": "All farmers with land records",
        "apply_url": "https://www.nabard.org/kcc.aspx",
        "state": "All India",
        "deadline": "2026-12-31",
    },
]

@router.get("/api/v1/subsidies")
def subsidies(state: Optional[str] = Query(None)):
    items = _SUBSIDIES
    if state:
        items = [s for s in items if s["state"] in (state, "All India")]
    return {"count": len(items), "items": items}

# ── AI Recommendations (irrigation, based on weather + crop) ───────────────

# ─── Spray-window helper: best 3 h in the next 48 h ─────────────────────────

def _best_spray_window(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Fetch hourly wind + precipitation from Open-Meteo and slide a 3-hour
    window through the next 48 h to find the calmest, driest slot.
    Scoring: hard-reject any hour with rain>0.2 mm or precip prob >= 40 %;
    among the survivors, pick the earliest window with mean wind < 12 km/h
    and no hourly gust above 20 km/h. Returns None if no such window exists
    (rain everywhere in the next 48 h — farmer should wait).
    """
    cache_key = f"spray-window:{lat:.3f}:{lon:.3f}"
    cached = _cache_get(cache_key, ttl_s=600)
    if cached is not None:
        return cached
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lon,
                    "hourly":   "precipitation,precipitation_probability,wind_speed_10m",
                    "forecast_days": 3,
                    "timezone": "auto",
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return None

    hourly = data.get("hourly", {}) or {}
    times = hourly.get("time", []) or []
    precip = hourly.get("precipitation", []) or []
    prob   = hourly.get("precipitation_probability", []) or []
    wind   = hourly.get("wind_speed_10m", []) or []
    if len(times) < 3:
        return None

    # Slide a 3-hour window through the first 48 h. Skip past hours.
    from datetime import datetime as _dt
    now_iso = _dt.utcnow().isoformat()
    best = None
    for i in range(0, min(48, len(times) - 2)):
        # Only consider windows starting in the future
        if times[i] < now_iso:
            continue
        wnd_precip = [precip[i], precip[i+1], precip[i+2]]
        wnd_prob   = [prob[i],   prob[i+1],   prob[i+2]]
        wnd_wind   = [wind[i],   wind[i+1],   wind[i+2]]
        # Hard reject: any hour with real rain expected
        if any(p is not None and p > 0.2 for p in wnd_precip):        continue
        if any(p is not None and p >= 40  for p in wnd_prob):         continue
        if any(w is not None and w > 20  for w in wnd_wind):          continue
        mean_wind = sum(w for w in wnd_wind if w is not None) / max(1, sum(1 for w in wnd_wind if w is not None))
        if mean_wind > 12:                                            continue
        best = {
            "start_iso":     times[i],
            "end_iso":       times[i+2],
            "mean_wind_kmh": round(mean_wind, 1),
            "max_rain_prob": max((p for p in wnd_prob if p is not None), default=0),
        }
        break   # earliest good window wins

    _cache_put(cache_key, best)
    return best


# ─── Crop-stage helpers (used by the crop-stage-aware advisory) ──────────────

# Rough universal stage model. Works well enough for ragi, rice, maize,
# tomato, chilli — the crops KisanShakti farmers actually grow. When we
# have real per-crop lifecycle data we'll swap this for a lookup table.
def _crop_stage(days_since_sowing: int) -> str:
    if days_since_sowing < 0:   return "pre-sowing"
    if days_since_sowing <= 21: return "seedling"
    if days_since_sowing <= 60: return "vegetative"
    if days_since_sowing <= 90: return "flowering"
    return "maturity"

def _stage_kn(stage: str) -> str:
    return {
        "pre-sowing":  "ಬಿತ್ತನೆ ಮೊದಲು",
        "seedling":    "ಸಸಿ",
        "vegetative":  "ಬೆಳವಣಿಗೆ",
        "flowering":   "ಹೂ / ಕಾಳು",
        "maturity":    "ಮಾಗುವ ಸಮಯ",
    }.get(stage, stage)

# Threshold shift for the soil-moisture irrigation rules. Positive numbers
# mean "irrigate sooner" (crop needs more water), negative means "let it
# dry a bit" (near-harvest wants stress to firm grain).
def _stage_moisture_bias(stage: str) -> int:
    return {
        "seedling":   +5,   # needs light, frequent water
        "vegetative":  0,   # baseline
        "flowering":  +3,   # critical — drought here = big yield hit
        "maturity":  -10,   # withhold water to firm grain
    }.get(stage, 0)


def _load_farmer_crop_context(db, farmer_id: str) -> Optional[Dict[str, Any]]:
    """
    Look up the farmer's most recent GROWING crop cycle and derive its
    stage. Returns None (no context) if the farmer hasn't logged any
    growing cycle — advisory falls back to generic messaging.
    """
    if not farmer_id:
        return None
    try:
        from models import CropCycle, CycleStatus
        cycle = (
            db.query(CropCycle)
              .filter(CropCycle.logged_by_farmer_id == farmer_id,
                      CropCycle.status == CycleStatus.GROWING)
              .order_by(CropCycle.sowing_date.desc())
              .first()
        )
    except Exception:
        return None
    if cycle is None or cycle.sowing_date is None:
        return None
    from datetime import date as _date
    days = (_date.today() - cycle.sowing_date).days
    stage = _crop_stage(days)
    return {
        "crop_name":    cycle.crop_name,
        "crop_name_kn": cycle.crop_name_kn,
        "sowing_date":  cycle.sowing_date.isoformat(),
        "days_since_sowing": days,
        "stage":        stage,
        "stage_kn":     _stage_kn(stage),
    }


@router.get("/api/v1/insights/irrigation")
def irrigation_insight(
    lat: float = Query(13.1367),
    lon: float = Query(78.1325),
    soil_moisture: Optional[float] = Query(None, description="0-100%; from BLE sensor if available"),
    sensor_temp: Optional[float]   = Query(None, description="°C; from DHT22 if available"),
    sensor_humidity: Optional[float] = Query(None, description="0-100%; from DHT22 if available"),
    sensor_is_raining: Optional[bool] = Query(None, description="LM393 rain-detector"),
    farmer_id: Optional[str] = Query(None, description="If set, look up the farmer's active crop cycle to tune advice"),
    db: Session = Depends(database.get_db),
):
    """
    Rule-based agri-advisory bundle: irrigation, fungal-risk, spraying-window.
    Prefers on-field ESP32 sensor values when supplied; falls back to
    weather API otherwise. When `farmer_id` is passed, the advice is tuned
    to the farmer's active crop stage (seedling/vegetative/flowering/maturity).
    """
    crop_ctx = _load_farmer_crop_context(db, farmer_id) if farmer_id else None
    stage    = crop_ctx["stage"] if crop_ctx else None
    bias     = _stage_moisture_bias(stage) if stage else 0
    # ── Data sources (sensor overrides API when present) ────────────────
    w  = weather_current(lat=lat, lon=lon)
    fc = weather_forecast(lat=lat, lon=lon, days=1)

    api_temp   = w.get("temp_c", 28)
    api_humid  = w.get("humidity", 60)
    api_wind   = w.get("wind_kmh", 0)
    cond       = w.get("condition", "Clear")

    temp   = sensor_temp     if sensor_temp     is not None else api_temp
    humid  = sensor_humidity if sensor_humidity is not None else api_humid
    is_raining_now = bool(sensor_is_raining) if sensor_is_raining is not None else False

    next24_pct = fc.get("next_24h_rain_pct")
    next24_mm  = fc.get("next_24h_rain_mm")
    rain_coming = (next24_pct or 0) >= 60 and (next24_mm or 0) >= 1.0

    # ── Irrigation rules ────────────────────────────────────────────────
    if is_raining_now:
        irr_level, irr_msg, irr_msg_kn = (
            "low",
            "It is raining now. Hold irrigation.",
            "ಈಗ ಮಳೆ ಬರುತ್ತಿದೆ. ನೀರಾವರಿ ನಿಲ್ಲಿಸಿ.",
        )
    elif soil_moisture is not None:
        # Bias the thresholds by crop stage. Seedlings/flowering need more
        # water (bias > 0 → higher effective threshold → irrigate sooner);
        # near-harvest wants stress (bias < 0 → let it dry).
        dry_thresh     = 30 + bias   # was 30
        modrate_thresh = 55 + bias   # was 55
        # Special-case maturity: at 91+ days the goal is to *reduce* watering
        # to firm grain. We rewrite the messaging in that branch.
        if stage == "maturity" and soil_moisture > 25:
            irr_level, irr_msg, irr_msg_kn = (
                "low",
                f"{crop_ctx['crop_name']} is in maturity ({crop_ctx['days_since_sowing']} days old) — hold irrigation, let the grain firm.",
                f"{crop_ctx['crop_name']} ಮಾಗುತ್ತಿದೆ ({crop_ctx['days_since_sowing']} ದಿನ) — ನೀರಾವರಿ ನಿಲ್ಲಿಸಿ, ಕಾಳು ಗಟ್ಟಿಯಾಗಲಿ.",
            )
        elif soil_moisture < dry_thresh and not rain_coming:
            irr_level, irr_msg, irr_msg_kn = (
                "high",
                f"Soil is dry ({soil_moisture:.0f}%). Irrigate today.",
                f"ಮಣ್ಣು ಒಣಗಿದೆ ({soil_moisture:.0f}%). ಇಂದೇ ನೀರು ಕೊಡಿ.",
            )
        elif soil_moisture < dry_thresh and rain_coming:
            irr_level, irr_msg, irr_msg_kn = (
                "medium",
                f"Soil dry ({soil_moisture:.0f}%) but rain expected in 24 h — wait.",
                f"ಮಣ್ಣು ಒಣಗಿದೆ ಆದರೆ 24 ಗಂಟೆಯಲ್ಲಿ ಮಳೆ ನಿರೀಕ್ಷಿತ — ಕಾಯಿರಿ.",
            )
        elif soil_moisture < modrate_thresh:
            irr_level, irr_msg, irr_msg_kn = (
                "medium",
                f"Soil moisture moderate ({soil_moisture:.0f}%). Irrigate in 12–24 h.",
                f"ಮಣ್ಣಿನ ತೇವಾಂಶ ಸಾಧಾರಣ ({soil_moisture:.0f}%). 12–24 ಗಂಟೆಯಲ್ಲಿ ನೀರಾವರಿ.",
            )
        else:
            irr_level, irr_msg, irr_msg_kn = (
                "low",
                f"Soil moisture good ({soil_moisture:.0f}%). No irrigation needed.",
                f"ಮಣ್ಣಿನ ತೇವಾಂಶ ಚೆನ್ನಾಗಿದೆ ({soil_moisture:.0f}%). ನೀರಾವರಿ ಅವಶ್ಯಕತೆ ಇಲ್ಲ.",
            )
        # Prefix a one-line crop-stage note so the message reads naturally.
        if crop_ctx and stage != "maturity":
            prefix_en = f"{crop_ctx['crop_name']} ({crop_ctx['days_since_sowing']}d, {stage}): "
            prefix_kn = f"{crop_ctx['crop_name']} ({crop_ctx['days_since_sowing']} ದಿನ, {crop_ctx['stage_kn']}): "
            irr_msg    = prefix_en + irr_msg
            irr_msg_kn = prefix_kn + irr_msg_kn
    else:
        if rain_coming:
            irr_level, irr_msg, irr_msg_kn = (
                "low",
                f"Rain expected in 24 h ({next24_pct or 0}%). Hold irrigation.",
                f"24 ಗಂಟೆಯಲ್ಲಿ ಮಳೆ ({next24_pct or 0}%). ನೀರಾವರಿ ನಿಲ್ಲಿಸಿ.",
            )
        elif temp >= 32 and humid < 50:
            irr_level, irr_msg, irr_msg_kn = (
                "high",
                "Hot & dry. Irrigate early morning or evening.",
                "ಬಿಸಿ ಮತ್ತು ಒಣ. ಮುಂಜಾನೆ ಅಥವಾ ಸಂಜೆ ನೀರಾವರಿ.",
            )
        elif temp >= 28:
            irr_level, irr_msg, irr_msg_kn = (
                "medium",
                "Warm day. Check soil, irrigate if dry.",
                "ಬೆಚ್ಚಗಿನ ದಿನ. ಮಣ್ಣು ಪರಿಶೀಲಿಸಿ, ಒಣಗಿದ್ದರೆ ನೀರಾವರಿ.",
            )
        else:
            irr_level, irr_msg, irr_msg_kn = (
                "low",
                "Conditions mild. No urgent irrigation needed.",
                "ಸಾಧಾರಣ ಹವಾಮಾನ. ತಕ್ಷಣದ ನೀರಾವರಿ ಅವಶ್ಯಕತೆ ಇಲ್ಲ.",
            )

    # ── Fungal / pest outbreak (humidity>85 + 20–28°C canopy) ───────────
    fungal_risk = humid >= 85 and 20 <= temp <= 28
    if fungal_risk:
        fungal = {
            "level":    "high",
            "title":    "High fungal risk",
            "title_kn": "ಶಿಲೀಂಧ್ರ ಅಪಾಯ ಹೆಚ್ಚು",
            "message":  f"Humidity {humid:.0f}% at {temp:.0f}°C favours Late Blight / Downy Mildew. "
                        "Inspect leaves, consider preventive spray (copper oxychloride).",
            "message_kn": f"{humid:.0f}% ಆರ್ದ್ರತೆ ಮತ್ತು {temp:.0f}°C ತಾಪಮಾನ — ಶಿಲೀಂಧ್ರ ರೋಗಗಳಿಗೆ ಅನುಕೂಲ. "
                          "ಎಲೆಗಳನ್ನು ಪರಿಶೀಲಿಸಿ, ತಾಮ್ರ ಆಕ್ಸಿಕ್ಲೋರೈಡ್ ಸಿಂಪಡಿಸಿ.",
        }
    elif humid >= 75 and 18 <= temp <= 30:
        fungal = {
            "level":    "medium",
            "title":    "Moderate fungal risk",
            "title_kn": "ಶಿಲೀಂಧ್ರ ಅಪಾಯ ಸಾಧಾರಣ",
            "message":  f"Humidity {humid:.0f}% is elevated — monitor leaves for early spots.",
            "message_kn": f"{humid:.0f}% ಆರ್ದ್ರತೆ ಹೆಚ್ಚಾಗಿದೆ — ಎಲೆಗಳಲ್ಲಿ ಆರಂಭಿಕ ಚುಕ್ಕೆಗಳನ್ನು ಗಮನಿಸಿ.",
        }
    else:
        fungal = {
            "level":    "low",
            "title":    "Fungal risk low",
            "title_kn": "ಶಿಲೀಂಧ್ರ ಅಪಾಯ ಕಡಿಮೆ",
            "message":  "Current conditions do not favour common fungal outbreaks.",
            "message_kn": "ಪ್ರಸ್ತುತ ಹವಾಮಾನ ಶಿಲೀಂಧ್ರ ರೋಗಗಳಿಗೆ ಅನುಕೂಲವಲ್ಲ.",
        }

    # ── Spray window (rain + wind gate) ─────────────────────────────────
    wind_kmh = api_wind  # OpenWeather wind; sensor doesn't provide wind
    spray_ok = (
        not is_raining_now
        and (next24_pct or 0) < 40
        and wind_kmh < 15
    )
    if spray_ok:
        # Try to find a concrete best 3-hour window in the next 48h.
        # Falls back to the old generic "before 10am / after 4pm" message
        # when the hourly forecast can't be fetched.
        window = _best_spray_window(lat, lon)
        if window:
            try:
                from datetime import datetime as _dt
                start = _dt.fromisoformat(window["start_iso"])
                end   = _dt.fromisoformat(window["end_iso"])
                # e.g. "Tomorrow 6–9 AM" / "Today 4–7 PM"
                today = _dt.utcnow().date()
                day_lbl_en = "Today" if start.date() == today else "Tomorrow" if (start.date() - today).days == 1 else start.strftime("%a")
                day_lbl_kn = "ಇಂದು"   if start.date() == today else "ನಾಳೆ"     if (start.date() - today).days == 1 else start.strftime("%a")
                sh = start.strftime("%-I") if hasattr(start, "strftime") else str(start.hour)
                # Windows %I with a leading zero — strip it.
                sh_str = start.strftime("%I").lstrip("0") or "12"
                eh_str = end.strftime("%I").lstrip("0")   or "12"
                ampm   = end.strftime("%p")
                when_en = f"{day_lbl_en} {sh_str}–{eh_str} {ampm}"
                when_kn = f"{day_lbl_kn} {sh_str}–{eh_str}"
            except Exception:
                when_en = "next calm window"
                when_kn = "ಮುಂದಿನ ಶಾಂತ ಸಮಯ"
            spray = {
                "ok":       True,
                "title":    f"Best window: {when_en}",
                "title_kn": f"ಸೂಕ್ತ ಸಮಯ: {when_kn}",
                "message":  f"Mean wind {window['mean_wind_kmh']} km/h, rain chance {window['max_rain_prob']}%. "
                            "Perfect for pesticide/fungicide application.",
                "message_kn": f"ಗಾಳಿ {window['mean_wind_kmh']} km/h, ಮಳೆ ಸಾಧ್ಯತೆ {window['max_rain_prob']}%. "
                              "ಸಿಂಪರಣೆಗೆ ಸೂಕ್ತ.",
                "best_window": window,
            }
        else:
            spray = {
                "ok":       True,
                "title":    "Good spraying window",
                "title_kn": "ಸಿಂಪರಣೆಗೆ ಸೂಕ್ತ ಸಮಯ",
                "message":  f"Low rain chance ({next24_pct or 0}%) and calm wind ({wind_kmh:.0f} km/h). "
                            "Apply sprays before 10 AM or after 4 PM.",
                "message_kn": f"ಕಡಿಮೆ ಮಳೆ ಸಾಧ್ಯತೆ ({next24_pct or 0}%), ಶಾಂತ ಗಾಳಿ ({wind_kmh:.0f} km/h). "
                              "10 ಗಂಟೆಗೆ ಮೊದಲು ಅಥವಾ 4 ಗಂಟೆಯ ನಂತರ ಸಿಂಪಡಿಸಿ.",
                "best_window": None,
            }
    else:
        reasons_en = []
        reasons_kn = []
        if is_raining_now:               reasons_en.append("raining now");            reasons_kn.append("ಈಗ ಮಳೆ")
        if (next24_pct or 0) >= 40:      reasons_en.append(f"{next24_pct}% rain in 24h"); reasons_kn.append(f"24 ಗಂಟೆಯಲ್ಲಿ {next24_pct}% ಮಳೆ")
        if wind_kmh >= 15:               reasons_en.append(f"windy {wind_kmh:.0f} km/h"); reasons_kn.append(f"ಗಾಳಿ {wind_kmh:.0f} km/h")
        spray = {
            "ok":       False,
            "title":    "Avoid spraying now",
            "title_kn": "ಈಗ ಸಿಂಪಡಿಸಬೇಡಿ",
            "message":  "Spray will be washed away or drift — " + ", ".join(reasons_en) + ".",
            "message_kn": "ಸಿಂಪರಣೆ ಕೊಚ್ಚಿಹೋಗುತ್ತದೆ — " + ", ".join(reasons_kn) + ".",
            "best_window": None,
        }

    return {
        "irrigation": {
            "level":     irr_level,
            "title":     "Irrigation Recommended" if irr_level in ("high", "medium") else "No Irrigation Needed",
            "title_kn":  "ನೀರಾವರಿ ಶಿಫಾರಸು" if irr_level in ("high", "medium") else "ನೀರಾವರಿ ಅವಶ್ಯಕತೆ ಇಲ್ಲ",
            "message":   irr_msg,
            "message_kn": irr_msg_kn,
        },
        "fungal": fungal,
        "spray":  spray,
        "soil_moisture":    soil_moisture,
        "sensor_connected": any(v is not None for v in (soil_moisture, sensor_temp, sensor_humidity, sensor_is_raining)),
        "crop_context":     crop_ctx,   # null when farmer_id not passed or no active cycle
        "based_on": {
            "temp_c":       temp,
            "humidity":     humid,
            "condition":    cond,
            "wind_kmh":     wind_kmh,
            "next_24h_rain_pct": next24_pct,
            "next_24h_rain_mm":  next24_mm,
            "sensor_temp_used":     sensor_temp is not None,
            "sensor_humidity_used": sensor_humidity is not None,
        },
        # Legacy top-level fields kept for backwards compat with home screen
        "level":     irr_level,
        "title":     "Irrigation Recommended" if irr_level in ("high", "medium") else "No Irrigation Needed",
        "title_kn":  "ನೀರಾವರಿ ಶಿಫಾರಸು" if irr_level in ("high", "medium") else "ನೀರಾವರಿ ಅವಶ್ಯಕತೆ ಇಲ್ಲ",
        "message":   irr_msg,
    }
