/**
 * KisanShakti — Shared API Client
 * Centralised fetch wrapper for both Upaj and Mandi apps.
 * Handles offline fallback gracefully.
 */

import type {
  CropListing,
  SmartPriceResponse,
  FarmLedgerEntry,
  CreateListingRequest,
  BuyerPreferences,
  SendOTPResponse,
  VerifyOTPRequest,
  VerifyOTPResponse,
} from './types';

// Android emulator → 10.0.2.2 | iOS simulator → localhost | Physical device → your LAN IP
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

// ─── Auth Token State ─────────────────────────────────────────────────────
let _authToken: string | null = null;

/**
 * Call this after a successful login/token-refresh so every subsequent
 * apiFetch automatically carries the Authorization header.
 * Pass `null` to clear the token on logout.
 */
export function setAuthToken(token: string | null): void {
  _authToken = token;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  fallback?: T,
): Promise<T> {
  try {
    const authHeader: Record<string, string> =
      _authToken !== null ? { Authorization: `Bearer ${_authToken}` } : {};

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
        ...options?.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[API] ${path} failed — using fallback.`, err);
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

// ─── Crop Listings ────────────────────────────────────────────────────────
export const CropAPI = {
  getNearby: (lat: number, lon: number, radiusKm = 25): Promise<CropListing[]> =>
    apiFetch<CropListing[]>(
      `/api/v1/crops/nearby?latitude=${lat}&longitude=${lon}&radius_km=${radiusKm}`,
      undefined,
      [],
    ),

  createListing: (payload: CreateListingRequest): Promise<{ status: string; listing_id: string }> =>
    apiFetch('/api/v1/crops/listing', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ─── Smart Pricing ────────────────────────────────────────────────────────
export const PricingAPI = {
  getSmartPrice: (cropName: string, qualityModifier = 0): Promise<SmartPriceResponse> =>
    apiFetch<SmartPriceResponse>(
      `/api/v1/pricing/smart-price?crop_name=${cropName}&quality_modifier=${qualityModifier}`,
      { method: 'POST' },
      { crop_name: cropName, smart_price: 20.0 }, // fallback
    ),
};

// ─── Farm Ledger ─────────────────────────────────────────────────────────
export const LedgerAPI = {
  getAll: (): Promise<FarmLedgerEntry[]> =>
    apiFetch<FarmLedgerEntry[]>('/api/v1/farm-ledger', undefined, []),

  addEntry: (transaction_type: string, amount: number, category: string) =>
    apiFetch('/api/v1/farm-ledger', {
      method: 'POST',
      body: JSON.stringify({ transaction_type, amount, category }),
    }),
};

// ─── Buyer Preferences ───────────────────────────────────────────────────
export const BuyerAPI = {
  savePreferences: (prefs: BuyerPreferences) =>
    apiFetch(
      `/api/v1/buyers/preferences?shop_type=${prefs.shopType}&sourcing_radius_km=${prefs.radius}`,
      { method: 'POST' },
    ).catch(() => {}), // non-blocking
};

// ─── Auth ─────────────────────────────────────────────────────────────────
export const AuthAPI = {
  /**
   * Request an OTP for the given phone number.
   * In development the response may include `dev_otp` for convenience.
   */
  sendOTP: (phone: string): Promise<SendOTPResponse> =>
    apiFetch<SendOTPResponse>('/api/v1/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone } satisfies { phone: string }),
    }),

  /**
   * Verify the OTP and receive a JWT access token.
   * For new users, supply `name` and (for buyers) `shop_type`.
   */
  verifyOTP: (req: VerifyOTPRequest): Promise<VerifyOTPResponse> =>
    apiFetch<VerifyOTPResponse>('/api/v1/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
};
