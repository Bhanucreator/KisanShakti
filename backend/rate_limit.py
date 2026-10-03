"""
General-purpose sliding-window rate limiter.

In-memory, thread-safe, keyed by an arbitrary string (phone number, device_id,
buyer UUID, IP, etc.). Enough for a 50-user beta; swap for Redis or a proper
token-bucket at scale.

Usage
-----
    from rate_limit import check_rate

    # Per-device: allow 30 POSTs per 60-second window.
    check_rate(bucket="sensor_reading", key=device_id, cap=30, window_s=60,
               friendly="sensor readings")
"""
from __future__ import annotations

import collections
import threading
import time
from typing import Dict, DefaultDict

from fastapi import HTTPException, status


_lock = threading.Lock()
# One namespace per bucket → per-key deque of timestamps.
_buckets: Dict[str, DefaultDict[str, collections.deque]] = {}


def check_rate(*, bucket: str, key: str, cap: int, window_s: int,
               friendly: str = "requests") -> None:
    """
    Raise HTTP 429 if `key` has already made `cap` requests in the last
    `window_s` seconds under this `bucket`. Otherwise record the hit and return.

    Keys are strings — pass "" for global-anonymous entries you still want
    to lump together (rarely useful; prefer a real identifier).
    """
    if not key:
        return   # never rate-limit when we don't have an identifier
    now = time.monotonic()
    cutoff = now - window_s
    with _lock:
        ns = _buckets.setdefault(bucket, collections.defaultdict(collections.deque))
        dq = ns[key]
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= cap:
            retry_in = int(dq[0] + window_s - now)
            mins = max(1, retry_in // 60)
            unit = "min" if retry_in >= 60 else "sec"
            wait = mins if retry_in >= 60 else max(1, retry_in)
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many {friendly}. Try again in {wait} {unit}.",
            )
        dq.append(now)
