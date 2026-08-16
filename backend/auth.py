"""
Auth layer: OTPStore (min-heap TTL eviction, O(log n)) + JWTService.
OTP codes are SHA-256 hashed before storage.
Constant-time hmac.compare_digest prevents timing attacks.
"""

from __future__ import annotations
import hashlib, heapq, hmac, logging, random, threading, time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Final
import jwt
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)
_OTP_TTL: Final[int] = 300
_MAX_ATTEMPTS: Final[int] = 3
_JWT_ALGORITHM: Final[str] = "HS256"


@dataclass(slots=True)
class OTPRecord:
    code_hash: str
    expires_at: float
    attempts: int = 0

    def is_expired(self) -> bool:
        return time.monotonic() > self.expires_at

    def is_exhausted(self) -> bool:
        return self.attempts >= _MAX_ATTEMPTS

    def matches(self, code: str) -> bool:
        self.attempts += 1
        candidate = hashlib.sha256(code.encode()).hexdigest()
        return hmac.compare_digest(self.code_hash, candidate)


@dataclass(frozen=True)
class TokenClaims:
    user_id: str
    phone: str
    role: str  # "farmer" | "buyer"


class OTPStore:
    """
    Thread-safe OTP registry.
    Min-heap ordered by expiry — lazy eviction on each write, O(log n).
    """
    def __init__(self, ttl: int = _OTP_TTL) -> None:
        self._ttl = ttl
        self._records: dict[str, OTPRecord] = {}
        self._heap: list[tuple[float, str]] = []
        self._lock = threading.Lock()

    def generate(self, phone: str) -> str:
        code = f"{random.SystemRandom().randint(0, 999_999):06d}"
        code_hash = hashlib.sha256(code.encode()).hexdigest()
        expires_at = time.monotonic() + self._ttl
        with self._lock:
            self._records[phone] = OTPRecord(code_hash=code_hash, expires_at=expires_at)
            heapq.heappush(self._heap, (expires_at, phone))
            self._evict()
        logger.info("[OTP] Issued for %s — dev mode, remove SMS stub in prod", phone)
        return code

    def verify(self, phone: str, code: str) -> bool:
        with self._lock:
            record = self._records.get(phone)
            if record is None or record.is_expired():
                self._records.pop(phone, None)
                return False
            if record.is_exhausted():
                del self._records[phone]
                return False
            matched = record.matches(code)
            if matched or record.is_exhausted():
                self._records.pop(phone, None)
            return matched

    def _evict(self) -> None:
        now = time.monotonic()
        while self._heap and self._heap[0][0] < now:
            _, phone = heapq.heappop(self._heap)
            entry = self._records.get(phone)
            if entry and entry.is_expired():
                del self._records[phone]


class JWTService:
    """Stateless JWT creation and verification. Secret must be >= 32 chars."""

    def __init__(self, secret: str, expiry_days: int = 30) -> None:
        if len(secret) < 32:
            raise ValueError("JWT_SECRET must be >= 32 characters.")
        self._secret = secret
        self._expiry = timedelta(days=expiry_days)

    def create_token(self, user_id: str, phone: str, role: str) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user_id,
            "phone": phone,
            "role": role,
            "iat": int(now.timestamp()),
            "exp": int((now + self._expiry).timestamp()),
        }
        return jwt.encode(payload, self._secret, algorithm=_JWT_ALGORITHM)

    def decode_token(self, token: str) -> TokenClaims:
        try:
            data = jwt.decode(token, self._secret, algorithms=[_JWT_ALGORITHM])
            return TokenClaims(user_id=data["sub"], phone=data["phone"], role=data["role"])
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                detail="Session expired. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except jwt.InvalidTokenError:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token.",
                headers={"WWW-Authenticate": "Bearer"},
            )
