"""
Per-crop shelf-life map — drives auto-expiry of listings.

The map is deliberately conservative: err on the side of a SHORTER shelf
life than reality. A listing that expires 24h early costs the farmer one
extra tap to relist. A listing that expires 24h too late means a buyer
buys a rotten crop — much worse.

Crop names are matched case-insensitively AND against Kannada aliases.
Unknown crops fall back to DEFAULT_DAYS (7 days) — safe middle ground.

If we need per-farmer / per-storage overrides later, add a `shelf_days`
column to crop_listings and have the create path prefer it over this map.
"""
from __future__ import annotations
from typing import Dict

DEFAULT_DAYS: int = 7

# Canonical English → days. Kannada aliases (below) map into this table.
_SHELF_LIFE: Dict[str, int] = {
    # Perishable — 3 days
    "tomato":       3,
    "coriander":    3,
    "spinach":      3,
    "lettuce":      3,
    "mint":         3,
    "curry leaves": 3,
    "amaranth":     3,
    # Semi-perishable — 5 days
    "chilli":       5,
    "chili":        5,
    "brinjal":      5,
    "eggplant":     5,
    "cabbage":      5,
    "cauliflower":  5,
    "capsicum":     5,
    "bell pepper":  5,
    "cucumber":     5,
    "ladies finger":5,
    "okra":         5,
    "beans":        5,
    "green beans":  5,
    "peas":         5,
    # Storable roots + bulbs — 10 days
    "onion":        10,
    "potato":       10,
    "carrot":       10,
    "beetroot":     10,
    "radish":       10,
    "ginger":       10,
    "garlic":       10,
    "sweet potato": 10,
    "yam":          10,
    "pumpkin":      10,
    # Grains + pulses — 21 days
    "ragi":         21,
    "maize":        21,
    "corn":         21,
    "rice":         21,
    "paddy":        21,
    "wheat":        21,
    "jowar":        21,
    "bajra":        21,
    "millet":       21,
    "toor":         21,
    "tur":          21,
    "urad":         21,
    "moong":        21,
    "chana":        21,
    "gram":         21,
    "groundnut":    21,
    "peanut":       21,
    "sesame":       21,
    "til":          21,
    "sunflower":    21,
    "mustard":      21,
    # Cash crops handled elsewhere but included for completeness — 14 days
    "cotton":       14,
    "sugarcane":    14,
    "turmeric":     14,
}

# Kannada name → canonical English key. Sourced from the CROP_EMOJI/i18n
# tables the app already uses. Add liberally; unknown fall back to DEFAULT.
_KANNADA_ALIASES: Dict[str, str] = {
    "ಟೊಮ್ಯಾಟೊ": "tomato",
    "ಟೊಮೇಟೊ":  "tomato",
    "ಈರುಳ್ಳಿ":  "onion",
    "ಆಲೂಗಡ್ಡೆ": "potato",
    "ರಾಗಿ":     "ragi",
    "ಜೋಳ":     "maize",
    "ಗೋಧಿ":    "wheat",
    "ಅಕ್ಕಿ":     "rice",
    "ಮೆಣಸಿನಕಾಯಿ":"chilli",
    "ಕೊತ್ತಂಬರಿ": "coriander",
    "ಬದನೆಕಾಯಿ": "brinjal",
    "ಎಲೆಕೋಸು":  "cabbage",
    "ಬೆಂಡೆಕಾಯಿ": "okra",
    "ಬೀಟ್ರೂಟ್":  "beetroot",
    "ಶುಂಠಿ":     "ginger",
    "ಬೆಳ್ಳುಳ್ಳಿ":  "garlic",
    "ಶೇಂಗಾ":    "groundnut",
    "ಹತ್ತಿ":     "cotton",
    "ಕಬ್ಬು":     "sugarcane",
    "ಅರಿಶಿನ":   "turmeric",
}


def days_for(crop_name: str | None) -> int:
    """
    Return shelf-life in days for a given crop name. Case-insensitive,
    tolerant of trailing whitespace, and Kannada-aware. Unknown → DEFAULT_DAYS.

    Usage:
        expires_at = created_at + timedelta(days=days_for(crop_name))
    """
    if not crop_name:
        return DEFAULT_DAYS
    key = crop_name.strip()
    # Kannada script first — some entries mix scripts, so check both paths.
    if key in _KANNADA_ALIASES:
        key = _KANNADA_ALIASES[key]
    lower = key.lower()
    if lower in _SHELF_LIFE:
        return _SHELF_LIFE[lower]
    # Second pass: allow partial match on the first token (e.g. "Tomato F1"
    # → matches "tomato"). Keeps the table small without missing variants.
    first_word = lower.split()[0] if lower else ""
    if first_word in _SHELF_LIFE:
        return _SHELF_LIFE[first_word]
    return DEFAULT_DAYS
