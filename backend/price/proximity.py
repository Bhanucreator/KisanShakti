"""
Proximity ranking for market-price rows.

Given a farmer's GPS point and a list of price rows (each carrying a
market name), attach a `distance_km` field and return rows sorted
nearest-first. Rows for markets we don't have coordinates for get
distance_km=None and sink to the bottom — never dropped silently.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from data.apmc_locations import lookup as _lookup_apmc

# "Nearest" scope caps: return up to _MAX_ROWS and never farther than _MAX_KM.
# 300 km comfortably covers Karnataka-inside-Karnataka (Kolar → Belagavi
# is ~530 km, well outside — that's what the "All Karnataka" chip is for).
MAX_RANKED_ROWS = 20
MAX_RANKED_KM   = 300.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two (lat, lon) points."""
    R  = 6371.0
    φ1 = math.radians(lat1)
    φ2 = math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a  = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def annotate_and_rank(
    rows:        List[Dict[str, Any]],
    farmer_lat:  Optional[float],
    farmer_lon:  Optional[float],
    *,
    limit:       int   = MAX_RANKED_ROWS,
    max_km:      float = MAX_RANKED_KM,
    nearest_only:bool  = True,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Attach distance_km + resolved district onto each row and sort.

    If farmer_lat/lon is missing, rows are returned unchanged (still with
    resolved district if we can find it) and no `note` is emitted.

    When `nearest_only=True`, unknown-location rows are dropped after
    all known ones have been placed — otherwise they trail the known set.

    Returns (rows, note) where `note` is a human-readable hint the frontend
    can show, e.g. "12 markets within 300 km" or "Location unavailable —
    showing all results".
    """
    for r in rows:
        loc = _lookup_apmc(r.get("market", ""))
        if loc:
            # Fill/override district from our authoritative map (AGMARKNET
            # sometimes prints stale district; KMV doesn't print it at all).
            r["district"]      = loc["district"]
            r["market_state"]  = loc["state"]
            if farmer_lat is not None and farmer_lon is not None:
                r["distance_km"] = round(
                    haversine_km(farmer_lat, farmer_lon, loc["lat"], loc["lon"]), 1
                )
            else:
                r["distance_km"] = None
        else:
            r.setdefault("district", r.get("district", ""))
            r["distance_km"] = None

    if farmer_lat is None or farmer_lon is None:
        return rows, None

    def _sort_key(r: Dict[str, Any]) -> tuple:
        d = r.get("distance_km")
        # None sinks to the bottom
        return (d is None, d if d is not None else float("inf"))

    rows_sorted = sorted(rows, key=_sort_key)

    if nearest_only:
        within = [r for r in rows_sorted if r.get("distance_km") is not None
                                        and r["distance_km"] <= max_km]
        picked = within[:limit]
        note   = (f"{len(picked)} markets within {int(max_km)} km"
                  if picked else
                  f"No known APMCs within {int(max_km)} km — showing farthest matches")
        # If nothing within cap, fall back to closest N regardless (so the
        # farmer isn't staring at an empty screen — but we say so honestly).
        if not picked:
            picked = [r for r in rows_sorted if r.get("distance_km") is not None][:limit]
        return picked, note

    return rows_sorted[:limit], f"Sorted by distance from your farm"
