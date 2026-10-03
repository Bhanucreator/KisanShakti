"""
Static coordinate table for Indian APMC yards.

Used by the proximity ranker to sort market-price rows by physical distance
from a farmer's GPS point. Curated by hand for accuracy — Nominatim would
mis-resolve small-town markets (multiple "Kolar" hits, "Malur" is also in
Kerala, etc). Extend as new markets appear in KMV/AGMARKNET output.

Key = normalized market name (lowercased, whitespace-collapsed, "apmc"
suffix and punctuation dropped). See `_normalize_key` for the canonical
transformation.

Coverage:
  - Karnataka: all major APMCs across all 30 districts (Kolar-region
    exhaustively, since that's the primary user base for KisanShakti).
  - Priority states: top APMCs for Tamil Nadu, Maharashtra, Andhra Pradesh,
    Telangana — where Karnataka farmers commonly ship produce.

Unmapped markets get distance_km=None and sink to the bottom of ranked
lists — never dropped silently. (Fail-honest per the app's core rule.)
"""
from __future__ import annotations

import re
from typing import Optional, TypedDict


class ApmcLoc(TypedDict):
    state:    str
    district: str
    lat:      float
    lon:      float


def _normalize_key(market_name: str) -> str:
    """Canonicalize a market name for lookup.

    "BANGARPET" → "bangarpet"
    "Bangarpet APMC" → "bangarpet"
    "K.R.Pet" → "krpet"
    "Binny Mill (F&V)" → "binnymillfv"
    "APMC THIRTHAHALLI" → "thirthahalli"
    """
    s = market_name.strip().lower()
    s = re.sub(r"\bapmc\b", "", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


# ─────────────────────────────────────────────────────────────────────────
# Karnataka — Kolar & neighboring districts (Chikkaballapur, Bengaluru
# Rural/Urban, Tumakuru). Highest priority — this is the KisanShakti core.
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_KOLAR_REGION: dict[str, ApmcLoc] = {
    "kolar":         {"state": "Karnataka", "district": "Kolar",          "lat": 13.1367, "lon": 78.1325},
    "bangarpet":     {"state": "Karnataka", "district": "Kolar",          "lat": 12.9866, "lon": 78.1774},
    "srinivaspur":   {"state": "Karnataka", "district": "Kolar",          "lat": 13.3418, "lon": 78.2129},
    "malur":         {"state": "Karnataka", "district": "Kolar",          "lat": 13.0033, "lon": 77.9370},
    "mulbagal":      {"state": "Karnataka", "district": "Kolar",          "lat": 13.1650, "lon": 78.3924},
    "chintamani":    {"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.4020, "lon": 78.0570},
    "chikkaballapur":{"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.4353, "lon": 77.7315},
    "chickballapur": {"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.4353, "lon": 77.7315},
    "bagepalli":     {"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.7833, "lon": 77.7833},
    "gauribidanur":  {"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.6100, "lon": 77.5170},
    "gowribidnur":   {"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.6100, "lon": 77.5170},
    "sidlaghatta":   {"state": "Karnataka", "district": "Chikkaballapur", "lat": 13.3906, "lon": 77.8635},
}

# ─────────────────────────────────────────────────────────────────────────
# Karnataka — Bengaluru & inner ring
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_BENGALURU: dict[str, ApmcLoc] = {
    "binnymill":       {"state": "Karnataka", "district": "Bengaluru Urban", "lat": 12.9784, "lon": 77.5583},
    "binnymillfv":     {"state": "Karnataka", "district": "Bengaluru Urban", "lat": 12.9784, "lon": 77.5583},
    "yeshwanthpur":    {"state": "Karnataka", "district": "Bengaluru Urban", "lat": 13.0290, "lon": 77.5397},
    "yarahalli":       {"state": "Karnataka", "district": "Bengaluru Rural", "lat": 13.0530, "lon": 77.4340},
    "hoskote":         {"state": "Karnataka", "district": "Bengaluru Rural", "lat": 13.0708, "lon": 77.7986},
    "doddaballapur":   {"state": "Karnataka", "district": "Bengaluru Rural", "lat": 13.2954, "lon": 77.5378},
    "devanahalli":     {"state": "Karnataka", "district": "Bengaluru Rural", "lat": 13.2489, "lon": 77.7118},
    "ramanagara":      {"state": "Karnataka", "district": "Ramanagara",      "lat": 12.7217, "lon": 77.2802},
    "channapatna":     {"state": "Karnataka", "district": "Ramanagara",     "lat": 12.6503, "lon": 77.2065},
    "kanakapura":      {"state": "Karnataka", "district": "Ramanagara",     "lat": 12.5487, "lon": 77.4213},
    "magadi":          {"state": "Karnataka", "district": "Ramanagara",     "lat": 12.9576, "lon": 77.2270},
}

# ─────────────────────────────────────────────────────────────────────────
# Karnataka — Southern (Mysuru / Mandya / Hassan / Chamarajanagar / Kodagu)
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_SOUTH: dict[str, ApmcLoc] = {
    "mysuru":          {"state": "Karnataka", "district": "Mysuru",          "lat": 12.2958, "lon": 76.6394},
    "mysore":          {"state": "Karnataka", "district": "Mysuru",          "lat": 12.2958, "lon": 76.6394},
    "hunsur":          {"state": "Karnataka", "district": "Mysuru",          "lat": 12.3037, "lon": 76.2941},
    "periyapatna":     {"state": "Karnataka", "district": "Mysuru",          "lat": 12.3357, "lon": 76.1013},
    "krnagar":         {"state": "Karnataka", "district": "Mysuru",          "lat": 12.4213, "lon": 76.3841},
    "crnagar":         {"state": "Karnataka", "district": "Chamarajanagar",  "lat": 11.9261, "lon": 76.9438},
    "chamarajanagar":  {"state": "Karnataka", "district": "Chamarajanagar",  "lat": 11.9261, "lon": 76.9438},
    "gundlupet":       {"state": "Karnataka", "district": "Chamarajanagar",  "lat": 11.8078, "lon": 76.6874},
    "kollegal":        {"state": "Karnataka", "district": "Chamarajanagar",  "lat": 12.1533, "lon": 77.1080},
    "mandya":          {"state": "Karnataka", "district": "Mandya",          "lat": 12.5218, "lon": 76.8951},
    "srirangapattana": {"state": "Karnataka", "district": "Mandya",          "lat": 12.4130, "lon": 76.7038},
    "pandavapura":     {"state": "Karnataka", "district": "Mandya",          "lat": 12.5085, "lon": 76.6673},
    "krpet":           {"state": "Karnataka", "district": "Mandya",          "lat": 12.6600, "lon": 76.4830},
    "maddur":          {"state": "Karnataka", "district": "Mandya",          "lat": 12.5850, "lon": 77.0450},
    "hassan":          {"state": "Karnataka", "district": "Hassan",          "lat": 13.0067, "lon": 76.0965},
    "arsikere":        {"state": "Karnataka", "district": "Hassan",          "lat": 13.3172, "lon": 76.2591},
    "arasikere":       {"state": "Karnataka", "district": "Hassan",          "lat": 13.3172, "lon": 76.2591},
    "arakalgud":       {"state": "Karnataka", "district": "Hassan",          "lat": 12.7615, "lon": 76.0640},
    "belur":           {"state": "Karnataka", "district": "Hassan",          "lat": 13.1616, "lon": 75.8630},
    "crpatna":         {"state": "Karnataka", "district": "Hassan",          "lat": 12.8760, "lon": 76.1000},
    "madikeri":        {"state": "Karnataka", "district": "Kodagu",          "lat": 12.4244, "lon": 75.7382},
}

# ─────────────────────────────────────────────────────────────────────────
# Karnataka — Central (Tumakuru / Shivamogga / Davanagere / Chitradurga)
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_CENTRAL: dict[str, ApmcLoc] = {
    "tumakuru":       {"state": "Karnataka", "district": "Tumakuru",        "lat": 13.3379, "lon": 77.1173},
    "tumkur":         {"state": "Karnataka", "district": "Tumakuru",        "lat": 13.3379, "lon": 77.1173},
    "madhugiri":      {"state": "Karnataka", "district": "Tumakuru",        "lat": 13.6600, "lon": 77.2103},
    "sira":           {"state": "Karnataka", "district": "Tumakuru",        "lat": 13.7418, "lon": 76.9052},
    "chikkanayakanahalli":{"state":"Karnataka","district":"Tumakuru",       "lat": 13.4174, "lon": 76.6238},
    "shivamogga":     {"state": "Karnataka", "district": "Shivamogga",      "lat": 13.9299, "lon": 75.5681},
    "shimoga":        {"state": "Karnataka", "district": "Shivamogga",      "lat": 13.9299, "lon": 75.5681},
    "shikaripura":    {"state": "Karnataka", "district": "Shivamogga",      "lat": 14.2618, "lon": 75.3527},
    "thirthahalli":   {"state": "Karnataka", "district": "Shivamogga",      "lat": 13.6892, "lon": 75.2400},
    "sagar":          {"state": "Karnataka", "district": "Shivamogga",      "lat": 14.1667, "lon": 75.0333},
    "davanagere":     {"state": "Karnataka", "district": "Davanagere",      "lat": 14.4644, "lon": 75.9218},
    "davangere":      {"state": "Karnataka", "district": "Davanagere",      "lat": 14.4644, "lon": 75.9218},
    "harappanahalli": {"state": "Karnataka", "district": "Vijayanagara",    "lat": 14.7900, "lon": 75.9856},
    "honnali":        {"state": "Karnataka", "district": "Davanagere",      "lat": 14.2427, "lon": 75.6529},
    "chitradurga":    {"state": "Karnataka", "district": "Chitradurga",     "lat": 14.2226, "lon": 76.4025},
    "chikkamagaluru": {"state": "Karnataka", "district": "Chikkamagaluru",  "lat": 13.3153, "lon": 75.7754},
    "chikmagalur":    {"state": "Karnataka", "district": "Chikkamagaluru",  "lat": 13.3153, "lon": 75.7754},
    "kadur":          {"state": "Karnataka", "district": "Chikkamagaluru",  "lat": 13.5590, "lon": 76.0130},
    "mudigere":       {"state": "Karnataka", "district": "Chikkamagaluru",  "lat": 13.1300, "lon": 75.6400},
}

# ─────────────────────────────────────────────────────────────────────────
# Karnataka — North (Belagavi / Dharwad / Hubballi / Vijayapura / Bagalkote)
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_NORTH: dict[str, ApmcLoc] = {
    "belagavi":       {"state": "Karnataka", "district": "Belagavi",        "lat": 15.8497, "lon": 74.4977},
    "belgaum":        {"state": "Karnataka", "district": "Belagavi",        "lat": 15.8497, "lon": 74.4977},
    "kudchi":         {"state": "Karnataka", "district": "Belagavi",        "lat": 16.7208, "lon": 74.8697},
    "hubballi":       {"state": "Karnataka", "district": "Dharwad",         "lat": 15.3647, "lon": 75.1240},
    "hubli":          {"state": "Karnataka", "district": "Dharwad",         "lat": 15.3647, "lon": 75.1240},
    "dharwad":        {"state": "Karnataka", "district": "Dharwad",         "lat": 15.4589, "lon": 75.0078},
    "hanagal":        {"state": "Karnataka", "district": "Haveri",          "lat": 14.7500, "lon": 75.1667},
    "haveri":         {"state": "Karnataka", "district": "Haveri",          "lat": 14.7935, "lon": 75.4045},
    "ranibennur":     {"state": "Karnataka", "district": "Haveri",          "lat": 14.6194, "lon": 75.6247},
    "ranebennur":     {"state": "Karnataka", "district": "Haveri",          "lat": 14.6194, "lon": 75.6247},
    "vijayapura":     {"state": "Karnataka", "district": "Vijayapura",      "lat": 16.8302, "lon": 75.7100},
    "bijapur":        {"state": "Karnataka", "district": "Vijayapura",      "lat": 16.8302, "lon": 75.7100},
    "bagalkote":      {"state": "Karnataka", "district": "Bagalkote",       "lat": 16.1817, "lon": 75.6944},
    "bagalkot":       {"state": "Karnataka", "district": "Bagalkote",       "lat": 16.1817, "lon": 75.6944},
    "haliyala":       {"state": "Karnataka", "district": "Uttara Kannada",  "lat": 15.3350, "lon": 74.7627},
}

# ─────────────────────────────────────────────────────────────────────────
# Karnataka — Kalyana (Raichur / Koppal / Ballari / Kalaburagi / Bidar / Yadgir)
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_KALYANA: dict[str, ApmcLoc] = {
    "raichur":        {"state": "Karnataka", "district": "Raichur",         "lat": 16.2076, "lon": 77.3463},
    "sindhanur":      {"state": "Karnataka", "district": "Raichur",         "lat": 15.7683, "lon": 76.7580},
    "manvi":          {"state": "Karnataka", "district": "Raichur",         "lat": 15.9902, "lon": 77.0562},
    "lingasugur":     {"state": "Karnataka", "district": "Raichur",         "lat": 16.1583, "lon": 76.5230},
    "koppal":         {"state": "Karnataka", "district": "Koppal",          "lat": 15.3547, "lon": 76.1583},
    "gangavathi":     {"state": "Karnataka", "district": "Koppal",          "lat": 15.4300, "lon": 76.5300},
    "kanakagiri":     {"state": "Karnataka", "district": "Koppal",          "lat": 15.4708, "lon": 76.1875},
    "kustagi":        {"state": "Karnataka", "district": "Koppal",          "lat": 15.7527, "lon": 76.1980},
    "ballari":        {"state": "Karnataka", "district": "Ballari",         "lat": 15.1394, "lon": 76.9214},
    "bellary":        {"state": "Karnataka", "district": "Ballari",         "lat": 15.1394, "lon": 76.9214},
    "hosapete":       {"state": "Karnataka", "district": "Vijayanagara",    "lat": 15.2695, "lon": 76.3878},
    "hospet":         {"state": "Karnataka", "district": "Vijayanagara",    "lat": 15.2695, "lon": 76.3878},
    "kalaburagi":     {"state": "Karnataka", "district": "Kalaburagi",      "lat": 17.3297, "lon": 76.8343},
    "gulbarga":       {"state": "Karnataka", "district": "Kalaburagi",      "lat": 17.3297, "lon": 76.8343},
    "bidar":          {"state": "Karnataka", "district": "Bidar",           "lat": 17.9104, "lon": 77.5199},
    "yadgir":         {"state": "Karnataka", "district": "Yadgir",          "lat": 16.7692, "lon": 77.1350},
}

# ─────────────────────────────────────────────────────────────────────────
# Karnataka — Coastal (Mangaluru / Udupi)
# ─────────────────────────────────────────────────────────────────────────
_KARNATAKA_COASTAL: dict[str, ApmcLoc] = {
    "mangaluru":      {"state": "Karnataka", "district": "Dakshina Kannada","lat": 12.9141, "lon": 74.8560},
    "mangalore":      {"state": "Karnataka", "district": "Dakshina Kannada","lat": 12.9141, "lon": 74.8560},
    "puttur":         {"state": "Karnataka", "district": "Dakshina Kannada","lat": 12.7597, "lon": 75.2010},
    "udupi":          {"state": "Karnataka", "district": "Udupi",           "lat": 13.3409, "lon": 74.7421},
    "karkala":        {"state": "Karnataka", "district": "Udupi",           "lat": 13.2000, "lon": 74.9833},
}

# ─────────────────────────────────────────────────────────────────────────
# Priority non-Karnataka (Tamil Nadu / Maharashtra / AP / Telangana top yards)
# — where Karnataka farmers commonly ship. Extend as more states join.
# ─────────────────────────────────────────────────────────────────────────
_OTHER_STATES: dict[str, ApmcLoc] = {
    # Tamil Nadu (tomato flows across KA border)
    "hosur":          {"state": "Tamil Nadu",  "district": "Krishnagiri",    "lat": 12.7409, "lon": 77.8253},
    "krishnagiri":    {"state": "Tamil Nadu",  "district": "Krishnagiri",    "lat": 12.5266, "lon": 78.2138},
    "chennai":        {"state": "Tamil Nadu",  "district": "Chennai",        "lat": 13.0827, "lon": 80.2707},
    "coimbatore":     {"state": "Tamil Nadu",  "district": "Coimbatore",     "lat": 11.0168, "lon": 76.9558},
    "salem":          {"state": "Tamil Nadu",  "district": "Salem",          "lat": 11.6643, "lon": 78.1460},
    "erode":          {"state": "Tamil Nadu",  "district": "Erode",          "lat": 11.3410, "lon": 77.7172},
    # Maharashtra (major onion / grapes / tomato yards)
    "nashik":         {"state": "Maharashtra", "district": "Nashik",         "lat": 19.9975, "lon": 73.7898},
    "pimpalgaon":     {"state": "Maharashtra", "district": "Nashik",         "lat": 20.1614, "lon": 74.0369},
    "lasalgaon":      {"state": "Maharashtra", "district": "Nashik",         "lat": 20.1516, "lon": 74.2400},
    "pune":           {"state": "Maharashtra", "district": "Pune",           "lat": 18.5204, "lon": 73.8567},
    "mumbai":         {"state": "Maharashtra", "district": "Mumbai",         "lat": 19.0760, "lon": 72.8777},
    "solapur":        {"state": "Maharashtra", "district": "Solapur",        "lat": 17.6599, "lon": 75.9064},
    "kolhapur":       {"state": "Maharashtra", "district": "Kolhapur",       "lat": 16.7050, "lon": 74.2433},
    # Andhra Pradesh
    "kurnool":        {"state": "Andhra Pradesh","district":"Kurnool",       "lat": 15.8281, "lon": 78.0373},
    "guntur":         {"state": "Andhra Pradesh","district":"Guntur",        "lat": 16.3067, "lon": 80.4365},
    "anantapur":      {"state": "Andhra Pradesh","district":"Anantapur",     "lat": 14.6819, "lon": 77.6006},
    "chittoor":       {"state": "Andhra Pradesh","district":"Chittoor",      "lat": 13.2172, "lon": 79.1003},
    "madanapalle":    {"state": "Andhra Pradesh","district":"Chittoor",      "lat": 13.5503, "lon": 78.5028},
    # Telangana
    "hyderabad":      {"state": "Telangana",   "district": "Hyderabad",      "lat": 17.3850, "lon": 78.4867},
    "warangal":       {"state": "Telangana",   "district": "Warangal",       "lat": 17.9689, "lon": 79.5941},
    "khammam":        {"state": "Telangana",   "district": "Khammam",        "lat": 17.2473, "lon": 80.1514},
}


APMC_LOCATIONS: dict[str, ApmcLoc] = {
    **_KARNATAKA_KOLAR_REGION,
    **_KARNATAKA_BENGALURU,
    **_KARNATAKA_SOUTH,
    **_KARNATAKA_CENTRAL,
    **_KARNATAKA_NORTH,
    **_KARNATAKA_KALYANA,
    **_KARNATAKA_COASTAL,
    **_OTHER_STATES,
}


# ─────────────────────────────────────────────────────────────────────────
# Punjab — major grain/vegetable APMCs (wheat, paddy, cotton, potato belt)
# ─────────────────────────────────────────────────────────────────────────
_PUNJAB: dict[str, ApmcLoc] = {
    "amritsar":       {"state": "Punjab", "district": "Amritsar",       "lat": 31.6340, "lon": 74.8723},
    "ludhiana":       {"state": "Punjab", "district": "Ludhiana",       "lat": 30.9010, "lon": 75.8573},
    "khanna":         {"state": "Punjab", "district": "Ludhiana",       "lat": 30.7050, "lon": 76.2222},
    "jalandhar":      {"state": "Punjab", "district": "Jalandhar",      "lat": 31.3260, "lon": 75.5762},
    "nakodar":        {"state": "Punjab", "district": "Jalandhar",      "lat": 31.1250, "lon": 75.4780},
    "patiala":        {"state": "Punjab", "district": "Patiala",        "lat": 30.3398, "lon": 76.3869},
    "nabha":          {"state": "Punjab", "district": "Patiala",        "lat": 30.3745, "lon": 76.1521},
    "rajpura":        {"state": "Punjab", "district": "Patiala",        "lat": 30.4838, "lon": 76.5947},
    "bathinda":       {"state": "Punjab", "district": "Bathinda",       "lat": 30.2110, "lon": 74.9455},
    "rampuraphul":    {"state": "Punjab", "district": "Bathinda",       "lat": 30.2666, "lon": 75.2400},
    "ferozepur":      {"state": "Punjab", "district": "Ferozepur",      "lat": 30.9264, "lon": 74.6109},
    "fazilka":        {"state": "Punjab", "district": "Fazilka",        "lat": 30.4028, "lon": 74.0286},
    "abohar":         {"state": "Punjab", "district": "Fazilka",        "lat": 30.1449, "lon": 74.1990},
    "muktsar":        {"state": "Punjab", "district": "Sri Muktsar Sahib","lat":30.4762,"lon": 74.5161},
    "moga":           {"state": "Punjab", "district": "Moga",           "lat": 30.8138, "lon": 75.1719},
    "faridkot":       {"state": "Punjab", "district": "Faridkot",       "lat": 30.6763, "lon": 74.7530},
    "kotkapura":      {"state": "Punjab", "district": "Faridkot",       "lat": 30.5850, "lon": 74.8320},
    "hoshiarpur":     {"state": "Punjab", "district": "Hoshiarpur",     "lat": 31.5344, "lon": 75.9114},
    "kapurthala":     {"state": "Punjab", "district": "Kapurthala",     "lat": 31.3800, "lon": 75.3830},
    "gurdaspur":      {"state": "Punjab", "district": "Gurdaspur",      "lat": 32.0417, "lon": 75.4053},
    "batala":         {"state": "Punjab", "district": "Gurdaspur",      "lat": 31.8180, "lon": 75.2020},
    "pathankot":      {"state": "Punjab", "district": "Pathankot",      "lat": 32.2733, "lon": 75.6522},
    "mansa":          {"state": "Punjab", "district": "Mansa",          "lat": 29.9987, "lon": 75.3934},
    "sangrur":        {"state": "Punjab", "district": "Sangrur",        "lat": 30.2458, "lon": 75.8421},
    "barnala":        {"state": "Punjab", "district": "Barnala",        "lat": 30.3782, "lon": 75.5462},
    "malerkotla":     {"state": "Punjab", "district": "Malerkotla",     "lat": 30.5250, "lon": 75.8792},
    "ropar":          {"state": "Punjab", "district": "Rupnagar",       "lat": 30.9686, "lon": 76.5231},
    "nawanshahr":     {"state": "Punjab", "district": "Shahid Bhagat Singh Nagar", "lat": 31.1250, "lon": 76.1250},
    "mohali":         {"state": "Punjab", "district": "SAS Nagar",      "lat": 30.7046, "lon": 76.7179},
}


# ─────────────────────────────────────────────────────────────────────────
# Uttar Pradesh — India's largest state, top ~40 APMCs by throughput
# ─────────────────────────────────────────────────────────────────────────
_UTTAR_PRADESH: dict[str, ApmcLoc] = {
    "lucknow":        {"state": "Uttar Pradesh", "district": "Lucknow",       "lat": 26.8467, "lon": 80.9462},
    "kanpur":         {"state": "Uttar Pradesh", "district": "Kanpur Nagar",  "lat": 26.4499, "lon": 80.3319},
    "agra":           {"state": "Uttar Pradesh", "district": "Agra",          "lat": 27.1767, "lon": 78.0081},
    "meerut":         {"state": "Uttar Pradesh", "district": "Meerut",        "lat": 28.9845, "lon": 77.7064},
    "varanasi":       {"state": "Uttar Pradesh", "district": "Varanasi",      "lat": 25.3176, "lon": 82.9739},
    "prayagraj":      {"state": "Uttar Pradesh", "district": "Prayagraj",     "lat": 25.4358, "lon": 81.8463},
    "allahabad":      {"state": "Uttar Pradesh", "district": "Prayagraj",     "lat": 25.4358, "lon": 81.8463},
    "ghaziabad":      {"state": "Uttar Pradesh", "district": "Ghaziabad",     "lat": 28.6692, "lon": 77.4538},
    "aligarh":        {"state": "Uttar Pradesh", "district": "Aligarh",       "lat": 27.8974, "lon": 78.0880},
    "bareilly":       {"state": "Uttar Pradesh", "district": "Bareilly",      "lat": 28.3670, "lon": 79.4304},
    "moradabad":      {"state": "Uttar Pradesh", "district": "Moradabad",     "lat": 28.8386, "lon": 78.7733},
    "gorakhpur":      {"state": "Uttar Pradesh", "district": "Gorakhpur",     "lat": 26.7606, "lon": 83.3732},
    "muzaffarnagar":  {"state": "Uttar Pradesh", "district": "Muzaffarnagar", "lat": 29.4727, "lon": 77.7085},
    "saharanpur":     {"state": "Uttar Pradesh", "district": "Saharanpur",    "lat": 29.9680, "lon": 77.5510},
    "ayodhya":        {"state": "Uttar Pradesh", "district": "Ayodhya",       "lat": 26.7922, "lon": 82.1998},
    "faizabad":       {"state": "Uttar Pradesh", "district": "Ayodhya",       "lat": 26.7734, "lon": 82.1550},
    "jhansi":         {"state": "Uttar Pradesh", "district": "Jhansi",        "lat": 25.4484, "lon": 78.5685},
    "mathura":        {"state": "Uttar Pradesh", "district": "Mathura",       "lat": 27.4924, "lon": 77.6737},
    "firozabad":      {"state": "Uttar Pradesh", "district": "Firozabad",     "lat": 27.1502, "lon": 78.3945},
    "etawah":         {"state": "Uttar Pradesh", "district": "Etawah",        "lat": 26.7784, "lon": 79.0159},
    "sitapur":        {"state": "Uttar Pradesh", "district": "Sitapur",       "lat": 27.5670, "lon": 80.6829},
    "hardoi":         {"state": "Uttar Pradesh", "district": "Hardoi",        "lat": 27.4165, "lon": 80.1305},
    "raebareli":      {"state": "Uttar Pradesh", "district": "Rae Bareli",    "lat": 26.2124, "lon": 81.2334},
    "bulandshahr":    {"state": "Uttar Pradesh", "district": "Bulandshahr",   "lat": 28.4069, "lon": 77.8497},
    "pilibhit":       {"state": "Uttar Pradesh", "district": "Pilibhit",      "lat": 28.6314, "lon": 79.8043},
    "shahjahanpur":   {"state": "Uttar Pradesh", "district": "Shahjahanpur",  "lat": 27.8830, "lon": 79.9086},
    "basti":          {"state": "Uttar Pradesh", "district": "Basti",         "lat": 26.8143, "lon": 82.7318},
    "deoria":         {"state": "Uttar Pradesh", "district": "Deoria",        "lat": 26.5028, "lon": 83.7796},
    "gonda":          {"state": "Uttar Pradesh", "district": "Gonda",         "lat": 27.1310, "lon": 81.9640},
    "barabanki":      {"state": "Uttar Pradesh", "district": "Barabanki",     "lat": 26.9250, "lon": 81.1932},
    "bahraich":       {"state": "Uttar Pradesh", "district": "Bahraich",      "lat": 27.5750, "lon": 81.5942},
    "sultanpur":      {"state": "Uttar Pradesh", "district": "Sultanpur",     "lat": 26.2647, "lon": 82.0728},
    "azamgarh":       {"state": "Uttar Pradesh", "district": "Azamgarh",      "lat": 26.0679, "lon": 83.1836},
    "ballia":         {"state": "Uttar Pradesh", "district": "Ballia",        "lat": 25.7548, "lon": 84.1470},
    "ghazipur":       {"state": "Uttar Pradesh", "district": "Ghazipur",      "lat": 25.5824, "lon": 83.5804},
    "mainpuri":       {"state": "Uttar Pradesh", "district": "Mainpuri",      "lat": 27.2350, "lon": 79.0250},
    "etah":           {"state": "Uttar Pradesh", "district": "Etah",          "lat": 27.5580, "lon": 78.6560},
    "budaun":         {"state": "Uttar Pradesh", "district": "Budaun",        "lat": 28.0338, "lon": 79.1266},
    "mau":            {"state": "Uttar Pradesh", "district": "Mau",           "lat": 25.9420, "lon": 83.5613},
    "unnao":          {"state": "Uttar Pradesh", "district": "Unnao",         "lat": 26.5464, "lon": 80.4879},
    "farrukhabad":    {"state": "Uttar Pradesh", "district": "Farrukhabad",   "lat": 27.3900, "lon": 79.5800},
    "banda":          {"state": "Uttar Pradesh", "district": "Banda",         "lat": 25.4770, "lon": 80.3350},
}


# ─────────────────────────────────────────────────────────────────────────
# Bihar — top APMCs (paddy, wheat, maize, litchi, makhana belt)
# ─────────────────────────────────────────────────────────────────────────
_BIHAR: dict[str, ApmcLoc] = {
    "patna":          {"state": "Bihar", "district": "Patna",         "lat": 25.5941, "lon": 85.1376},
    "gaya":           {"state": "Bihar", "district": "Gaya",          "lat": 24.7955, "lon": 85.0002},
    "bhagalpur":      {"state": "Bihar", "district": "Bhagalpur",     "lat": 25.2444, "lon": 86.9718},
    "muzaffarpur":    {"state": "Bihar", "district": "Muzaffarpur",   "lat": 26.1197, "lon": 85.3910},
    "purnia":         {"state": "Bihar", "district": "Purnia",        "lat": 25.7770, "lon": 87.4753},
    "darbhanga":      {"state": "Bihar", "district": "Darbhanga",     "lat": 26.1522, "lon": 85.8971},
    "chapra":         {"state": "Bihar", "district": "Saran",         "lat": 25.7796, "lon": 84.7278},
    "ara":            {"state": "Bihar", "district": "Bhojpur",       "lat": 25.5561, "lon": 84.6633},
    "arrah":          {"state": "Bihar", "district": "Bhojpur",       "lat": 25.5561, "lon": 84.6633},
    "munger":         {"state": "Bihar", "district": "Munger",        "lat": 25.3742, "lon": 86.4735},
    "katihar":        {"state": "Bihar", "district": "Katihar",       "lat": 25.5399, "lon": 87.5764},
    "motihari":       {"state": "Bihar", "district": "East Champaran","lat": 26.6437, "lon": 84.9111},
    "begusarai":      {"state": "Bihar", "district": "Begusarai",     "lat": 25.4182, "lon": 86.1272},
    "nawada":         {"state": "Bihar", "district": "Nawada",        "lat": 24.8879, "lon": 85.5433},
    "sasaram":        {"state": "Bihar", "district": "Rohtas",        "lat": 24.9482, "lon": 84.0270},
    "hajipur":        {"state": "Bihar", "district": "Vaishali",      "lat": 25.6857, "lon": 85.2100},
    "sitamarhi":      {"state": "Bihar", "district": "Sitamarhi",     "lat": 26.5952, "lon": 85.4907},
    "samastipur":     {"state": "Bihar", "district": "Samastipur",    "lat": 25.8560, "lon": 85.7810},
    "siwan":          {"state": "Bihar", "district": "Siwan",         "lat": 26.2211, "lon": 84.3562},
    "bettiah":        {"state": "Bihar", "district": "West Champaran","lat": 26.8025, "lon": 84.5028},
    "buxar":          {"state": "Bihar", "district": "Buxar",         "lat": 25.5647, "lon": 83.9776},
    "aurangabad":     {"state": "Bihar", "district": "Aurangabad",    "lat": 24.7521, "lon": 84.3742},
    "jehanabad":      {"state": "Bihar", "district": "Jehanabad",     "lat": 25.2129, "lon": 84.9866},
    "biharsharif":    {"state": "Bihar", "district": "Nalanda",       "lat": 25.2007, "lon": 85.5237},
    "madhubani":      {"state": "Bihar", "district": "Madhubani",     "lat": 26.3542, "lon": 86.0713},
    "saharsa":        {"state": "Bihar", "district": "Saharsa",       "lat": 25.8797, "lon": 86.5990},
    "kishanganj":     {"state": "Bihar", "district": "Kishanganj",    "lat": 26.1075, "lon": 87.9484},
    "araria":         {"state": "Bihar", "district": "Araria",        "lat": 26.1483, "lon": 87.5157},
    "supaul":         {"state": "Bihar", "district": "Supaul",        "lat": 26.1258, "lon": 86.6047},
    "khagaria":       {"state": "Bihar", "district": "Khagaria",      "lat": 25.5024, "lon": 86.4728},
    "gopalganj":      {"state": "Bihar", "district": "Gopalganj",     "lat": 26.4676, "lon": 84.4386},
}


# ─────────────────────────────────────────────────────────────────────────
# West Bengal — Kolkata + Gangetic-plain APMCs (paddy, jute, potato, tea)
# ─────────────────────────────────────────────────────────────────────────
_WEST_BENGAL: dict[str, ApmcLoc] = {
    "kolkata":        {"state": "West Bengal", "district": "Kolkata",          "lat": 22.5726, "lon": 88.3639},
    "howrah":         {"state": "West Bengal", "district": "Howrah",           "lat": 22.5958, "lon": 88.2636},
    "malda":          {"state": "West Bengal", "district": "Malda",            "lat": 25.0119, "lon": 88.1433},
    "siliguri":       {"state": "West Bengal", "district": "Darjeeling",       "lat": 26.7271, "lon": 88.3953},
    "asansol":        {"state": "West Bengal", "district": "Paschim Bardhaman","lat": 23.6889, "lon": 86.9661},
    "durgapur":       {"state": "West Bengal", "district": "Paschim Bardhaman","lat": 23.5204, "lon": 87.3119},
    "bardhaman":      {"state": "West Bengal", "district": "Purba Bardhaman",  "lat": 23.2325, "lon": 87.8615},
    "burdwan":        {"state": "West Bengal", "district": "Purba Bardhaman",  "lat": 23.2325, "lon": 87.8615},
    "krishnanagar":   {"state": "West Bengal", "district": "Nadia",            "lat": 23.4058, "lon": 88.4923},
    "kalyani":        {"state": "West Bengal", "district": "Nadia",            "lat": 22.9750, "lon": 88.4344},
    "berhampore":     {"state": "West Bengal", "district": "Murshidabad",      "lat": 24.1042, "lon": 88.2519},
    "bankura":        {"state": "West Bengal", "district": "Bankura",          "lat": 23.2324, "lon": 87.0710},
    "purulia":        {"state": "West Bengal", "district": "Purulia",          "lat": 23.3320, "lon": 86.3616},
    "midnapore":      {"state": "West Bengal", "district": "Paschim Medinipur","lat": 22.4257, "lon": 87.3197},
    "medinipur":      {"state": "West Bengal", "district": "Paschim Medinipur","lat": 22.4257, "lon": 87.3197},
    "kharagpur":      {"state": "West Bengal", "district": "Paschim Medinipur","lat": 22.3460, "lon": 87.2320},
    "contai":         {"state": "West Bengal", "district": "Purba Medinipur",  "lat": 21.7778, "lon": 87.7500},
    "tamluk":         {"state": "West Bengal", "district": "Purba Medinipur",  "lat": 22.2984, "lon": 87.9160},
    "balurghat":      {"state": "West Bengal", "district": "Dakshin Dinajpur", "lat": 25.2255, "lon": 88.7708},
    "raiganj":        {"state": "West Bengal", "district": "Uttar Dinajpur",   "lat": 25.6135, "lon": 88.1250},
    "cooch behar":    {"state": "West Bengal", "district": "Cooch Behar",      "lat": 26.3172, "lon": 89.4487},
    "coochbehar":     {"state": "West Bengal", "district": "Cooch Behar",      "lat": 26.3172, "lon": 89.4487},
    "jalpaiguri":     {"state": "West Bengal", "district": "Jalpaiguri",       "lat": 26.5216, "lon": 88.7196},
    "alipurduar":     {"state": "West Bengal", "district": "Alipurduar",       "lat": 26.4890, "lon": 89.5250},
    "suri":           {"state": "West Bengal", "district": "Birbhum",          "lat": 23.9080, "lon": 87.5292},
    "barasat":        {"state": "West Bengal", "district": "North 24 Parganas","lat": 22.7245, "lon": 88.4810},
    "barrackpore":    {"state": "West Bengal", "district": "North 24 Parganas","lat": 22.7595, "lon": 88.3729},
    "chinsurah":      {"state": "West Bengal", "district": "Hooghly",          "lat": 22.9101, "lon": 88.3900},
    "chunchura":      {"state": "West Bengal", "district": "Hooghly",          "lat": 22.9101, "lon": 88.3900},
    "arambagh":       {"state": "West Bengal", "district": "Hooghly",          "lat": 22.8850, "lon": 87.7830},
    "diamond harbour":{"state": "West Bengal", "district": "South 24 Parganas","lat": 22.1930, "lon": 88.1900},
    "diamondharbour": {"state": "West Bengal", "district": "South 24 Parganas","lat": 22.1930, "lon": 88.1900},
}


APMC_LOCATIONS.update(_PUNJAB)
APMC_LOCATIONS.update(_UTTAR_PRADESH)
APMC_LOCATIONS.update(_BIHAR)
APMC_LOCATIONS.update(_WEST_BENGAL)


def lookup(market_name: str) -> Optional[ApmcLoc]:
    """Return the coordinate entry for a market name, or None if unmapped."""
    if not market_name:
        return None
    return APMC_LOCATIONS.get(_normalize_key(market_name))
