"""
KMV — Krishi Marata Vahini (Karnataka state APMC portal) scraper.

Fetches daily per-market prices from https://krama.karnataka.gov.in.
KMV covers ~all 162 Karnataka APMCs including Kolar/Bangarpet/Chintamani/
Srinivaspur — markets that AGMARKNET's data.gov.in mirror routinely misses.
See memory: reference-kmv-portal.

Two entry points:

    discover_commodities()  → List[CommodityCode]
        Scrape homepage once, extract every (comm_code, var_code, comm_name,
        variety_name) tuple. Stable across days; cache heavily upstream.

    fetch_prices_for(cc, date=today) → List[KmvRow]
        Hit DailyMrktPriceRep2.aspx for one commodity. Returns one row per
        (market, date) that reported that commodity. Prices in ₹/quintal
        as provided; caller must ÷100 to store as ₹/kg.

Rate limit: throttle to ≥5s between requests. Browser User-Agent required
(the portal 403s or hangs on default Python UA — same class of bug as
[[feedback-agmarknet-user-agent]] on data.gov.in).
"""
from __future__ import annotations

import html
import logging
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import List, Optional

import httpx

log = logging.getLogger(__name__)

_BASE = "https://krama.karnataka.gov.in"
_REPORT_PATH = "/MainPage/DailyMrktPriceRep2.aspx"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Minimum gap between two consecutive KMV requests (portal is small; be polite).
_MIN_GAP_S = 5.0
_last_request_ts: float = 0.0


def _throttle() -> None:
    global _last_request_ts
    now = time.monotonic()
    wait = _MIN_GAP_S - (now - _last_request_ts)
    if wait > 0:
        time.sleep(wait)
    _last_request_ts = time.monotonic()


@dataclass(frozen=True)
class CommodityCode:
    comm_code: str
    var_code:  str
    comm_name: str        # e.g. "Tomato" (English half of "Tomato / ಟೊಮ್ಯಾಟೊ")
    var_name:  str        # e.g. "Hybrid"


@dataclass(frozen=True)
class KmvRow:
    market:         str              # e.g. "BANGARPET"
    arrival_date:   date
    commodity:      str              # e.g. "Tomato"
    variety:        Optional[str]    # sometimes distinct, sometimes same as commodity
    arrivals_qtl:   Optional[float]  # daily quintal arrivals
    min_qtl:        int              # ₹/quintal
    max_qtl:        int              # ₹/quintal
    modal_qtl:      int              # ₹/quintal

    def min_kg(self)   -> float: return self.min_qtl   / 100.0
    def max_kg(self)   -> float: return self.max_qtl   / 100.0
    def modal_kg(self) -> float: return self.modal_qtl / 100.0


def _get(url: str, params: Optional[dict] = None, timeout: float = 20.0) -> str:
    """
    Throttled GET with retry-on-timeout. Raises on final failure so caller
    can decide fallback strategy (usually: skip this commodity, keep the
    ones that succeeded — never silently substitute).
    """
    _throttle()
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout, headers=_HEADERS) as c:
                r = c.get(url, params=params, follow_redirects=True)
                r.raise_for_status()
                return r.text
        except Exception as e:
            last_err = e
            time.sleep(1.0 * (attempt + 1))
    raise last_err  # type: ignore[misc]


# ── Homepage discovery ─────────────────────────────────────────────────────
#
# Homepage anchors look like:
#   onclick="window.open('MainPage/DailyMrktPriceRep2.aspx?Rep=Com&CommCode=78
#           &VarCode=4&Date=02/09/2026&CommName=Tomato / ಟೊಮ್ಯಾಟೊ
#           &VarName=Hybrid / ಹೈಬ್ರಿಡ್');"
#
# Rep=Com anchors are the commodity-level "all markets today" report. Rep=Var
# anchors are the same but for a specific variety — we skip these because
# Rep=Com already includes them.

_ANCHOR_RE = re.compile(
    r"window\.open\(&#39;MainPage/DailyMrktPriceRep2\.aspx\?"
    r"Rep=(?P<rep>Com|Var)"
    r"&amp;CommCode=(?P<cc>\d+)"
    r"&amp;VarCode=(?P<vc>\d+)"
    r"&amp;Date=[^&]+"
    r"&amp;CommName=(?P<cname>[^&]+)"
    r"&amp;VarName=(?P<vname>[^&]+)"
    r"&#39;\)",
    re.IGNORECASE,
)


def discover_commodities() -> List[CommodityCode]:
    """
    Scrape the homepage once to get every (comm_code, var_code) pair.
    Returns Rep=Com anchors only (variety-level reports are redundant).
    """
    html_text = _get(_BASE + "/")
    out: List[CommodityCode] = []
    seen: set = set()
    for m in _ANCHOR_RE.finditer(html_text):
        if m.group("rep") != "Com":
            continue
        cc, vc = m.group("cc"), m.group("vc")
        key = (cc, vc)
        if key in seen:
            continue
        seen.add(key)
        cname = html.unescape(m.group("cname")).split("/")[0].strip()
        vname = html.unescape(m.group("vname")).split("/")[0].strip()
        out.append(CommodityCode(cc, vc, cname, vname))
    log.info("[kmv] discovered %d commodities", len(out))
    return out


# ── Per-commodity report parser ────────────────────────────────────────────

_ROW_RE  = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)
_TAG_RE  = re.compile(r"<[^>]+>")


def _clean(cell: str) -> str:
    return html.unescape(_TAG_RE.sub(" ", cell)).strip()


def _to_int(s: str) -> Optional[int]:
    s = s.replace(",", "").strip()
    if not s or not re.fullmatch(r"-?\d+", s):
        return None
    return int(s)


def _to_float(s: str) -> Optional[float]:
    s = s.replace(",", "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _parse_date(s: str) -> Optional[date]:
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


def fetch_prices_for(cc: CommodityCode, on_date: date) -> List[KmvRow]:
    """
    Fetch one commodity's daily report and parse into KmvRow list.
    Silently skips malformed rows (parser is defensive — the portal
    occasionally emits blank/header rows we don't want to blow up on).
    """
    params = {
        "Rep":      "Com",
        "CommCode": cc.comm_code,
        "VarCode":  cc.var_code,
        "Date":     on_date.strftime("%d/%m/%Y"),
        "CommName": cc.comm_name,
        "VarName":  cc.var_name,
    }
    html_text = _get(_BASE + _REPORT_PATH, params=params)

    out: List[KmvRow] = []
    for raw_row in _ROW_RE.findall(html_text):
        cells = [_clean(c) for c in _CELL_RE.findall(raw_row)]
        # Expected shape: [Market, Date, Commodity/Variety, Arrivals, Min, Max, Modal]
        if len(cells) < 7:
            continue
        market_s, date_s, comm_s, arr_s, min_s, max_s, modal_s = cells[:7]
        if not market_s or market_s.lower() in ("market", "s.no", "sr.no"):
            continue
        d = _parse_date(date_s)
        mn, mx, md = _to_int(min_s), _to_int(max_s), _to_int(modal_s)
        if d is None or mn is None or mx is None or md is None:
            continue
        # KMV lists market names in ALL CAPS — keep as-is for the cache
        # (normalization to Title Case happens in the read endpoint).
        out.append(KmvRow(
            market       = market_s,
            arrival_date = d,
            commodity    = cc.comm_name,
            variety      = comm_s if comm_s and comm_s != cc.comm_name else cc.var_name,
            arrivals_qtl = _to_float(arr_s),
            min_qtl      = mn,
            max_qtl      = mx,
            modal_qtl    = md,
        ))
    log.info("[kmv] %s/%s → %d rows for %s", cc.comm_name, cc.var_name,
             len(out), on_date.isoformat())
    return out


def fetch_full_snapshot(on_date: date) -> List[KmvRow]:
    """
    One-shot: discover every commodity, fetch each, concatenate. Respects
    the throttle globally so a full sweep takes ~10 minutes with the default
    5s gap and ~100 commodities. Meant to be called from the cron; the API
    layer reads out of the cache table populated by this function.
    """
    rows: List[KmvRow] = []
    for cc in discover_commodities():
        try:
            rows.extend(fetch_prices_for(cc, on_date))
        except Exception as e:
            log.warning("[kmv] fetch failed for %s/%s: %s",
                        cc.comm_name, cc.var_name, e)
    return rows
