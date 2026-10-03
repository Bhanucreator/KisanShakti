/**
 * Mandi buyer-side API client.
 *
 * Mirrors the shape of Upaj's api.ts (same req() wrapper, same graceful
 * `null` fallback on failure) so both apps talk to the backend the same way.
 * Auth token comes from AsyncStorage — that's where use-auth.ts stores it
 * after buyer login.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await AsyncStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

async function req<T>(path: string, opts: RequestInit = {}, fallback: T | null = null): Promise<T | null> {
  try {
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()), ...(opts.headers ?? {}) };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${API_BASE}${path}`, { ...opts, headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) { console.warn(`[api] ${path} → ${r.status}`); return fallback; }
    return (await r.json()) as T;
  } catch (e: any) {
    if (e?.name !== 'AbortError') console.warn(`[api] ${path} failed:`, e?.message);
    return fallback;
  }
}

// ── Types (parity with Upaj's api.ts) ──────────────────────────────────────
export type OfferStatus =
  | 'PENDING' | 'ACCEPTED' | 'IN_DELIVERY' | 'COMPLETED'
  | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED' | 'CANCELLED';
export type ListingStatus = 'AVAILABLE' | 'LOCKED' | 'SOLD';

export interface CommerceListing {
  id:               string;
  farmer_id:        string;
  farmer_name:      string | null;
  farmer_phone:     string | null;
  plot_id:          string | null;
  cycle_id:         string | null;
  crop_name:        string;
  crop_name_kn:     string | null;
  quantity_kg:      number;
  price_per_kg:     number;
  status:           ListingStatus;
  latitude:         number;
  longitude:        number;
  distance_km:      number | null;
  benchmark_price:  number | null;
  price_verified:   boolean;
  fair_price:       boolean;
  photo_url:        string | null;   // /uploads/... — resolve with API_BASE
  photos:           { id: string; url: string }[]; // ordered, primary first
  village:          string | null;   // reverse-geocoded on create
  farmer_rating:       number | null; // avg stars (1dp) — trust signal on the card
  farmer_rating_count: number;        // count of ratings so far ("⭐ 4.6 · 23 sales")
  // Auto-price-fit provenance (present when farmer used /pricing/suggest).
  // Lets the buyer see "Fitted from Bangarpet APMC · 13 km · ₹6/kg today"
  // — anchors trust in the ask price to real government mandi data.
  market_source_apmc:        string | null;
  market_source_district:    string | null;
  market_source_price_kg:    number | null;
  market_source_distance_km: number | null;
  market_source_date:        string | null;
  created_at:       string;
  expires_at:       string | null;
}

/** Turn a backend-relative /uploads/... path into a full URL RN's Image can load. */
export function resolvePhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${API_BASE}${path}`;
}

export interface CommerceOffer {
  id:                   string;
  listing_id:           string;
  listing_crop:         string | null;
  listing_photo_url:    string | null;
  listing_village:      string | null;
  farmer_id:            string | null;
  farmer_name:          string | null;
  farmer_phone:         string | null;
  buyer_id:             string;
  buyer_shop_name:      string | null;
  buyer_phone:          string | null;
  offered_price_per_kg: number;
  quantity_kg:          number;
  status:               OfferStatus;
  note:                 string | null;
  delivery_otp:         string | null;      // set only during IN_DELIVERY
  completed_at:         string | null;
  cancelled_reason:     string | null;
  rated:                boolean;             // this buyer has already rated the farmer on this offer
  created_at:           string;
  responded_at:         string | null;
  expires_at:           string;
}

export interface PriceBenchmark {
  crop_name:       string;
  district:        string;
  benchmark_price: number;
  source:          string;
  fetched_at:      string;
  ttl_hours:       number;
  stale:           boolean;
}

// ── Endpoints ──────────────────────────────────────────────────────────────

export function searchNearbyListings(opts: {
  lat: number; lng: number; radiusKm?: number; crop?: string; limit?: number;
}) {
  const p = new URLSearchParams();
  p.set('lat', String(opts.lat));
  p.set('lng', String(opts.lng));
  p.set('radius_km', String(opts.radiusKm ?? 25));
  if (opts.crop) p.set('crop', opts.crop);
  if (opts.limit) p.set('limit', String(opts.limit));
  return req<CommerceListing[]>(`/api/v1/listings/search?${p.toString()}`);
}

export function fetchListingDetail(id: string, buyerLat?: number, buyerLng?: number) {
  const p = new URLSearchParams();
  if (buyerLat != null) p.set('lat', String(buyerLat));
  if (buyerLng != null) p.set('lng', String(buyerLng));
  const qs = p.toString() ? `?${p.toString()}` : '';
  return req<CommerceListing>(`/api/v1/listings/${id}${qs}`);
}

export function submitOffer(listingId: string, body: {
  offered_price_per_kg: number; quantity_kg: number; note?: string | null;
}) {
  return req<CommerceOffer>(`/api/v1/listings/${listingId}/offers`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function withdrawOffer(offerId: string) {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}/withdraw`, { method: 'POST' });
}

/** Rate the farmer on a COMPLETED offer. Backend enforces one rating per offer. */
export function rateFarmer(offerId: string, stars: number, comment?: string) {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}/rate`, {
    method: 'POST',
    body: JSON.stringify({ stars, comment: comment ?? null }),
  });
}

/** Soft-hide a closed/past offer from the buyer's own lists. Row survives
 *  on the farmer side and in BI. Backend returns 400 if the offer is
 *  still active (PENDING/ACCEPTED/IN_DELIVERY). */
export function hideOfferFromBuyer(offerId: string) {
  return req<void>(`/api/v1/offers/${offerId}/hide`, { method: 'DELETE' });
}

export function fetchMyOffers() {
  return req<CommerceOffer[]>(`/api/v1/offers/mine`);
}

export function fetchMyOrders() {
  return req<CommerceOffer[]>(`/api/v1/offers/orders`);
}

/**
 * In-transit orders — the "delivery" tab. The response now contains the
 * buyer's OTP (`delivery_otp`) which they SHOW to the farmer on physical
 * delivery. Farmer types it into their app to close the trade.
 */
export function fetchMyDeliveries() {
  return req<CommerceOffer[]>(`/api/v1/offers/delivery`);
}

// ── Notifications ─────────────────────────────────────────────────────────

export interface NotificationItem {
  id:         string;
  kind:       string;
  title:      string;
  body:       string | null;
  deep_link:  string | null;
  read:       boolean;
  created_at: string;
}
export interface NotificationsFeed {
  total:  number;
  unread: number;
  items:  NotificationItem[];
}

export function fetchBuyerNotifications() {
  return req<NotificationsFeed>(`/api/v1/notifications/buyer`);
}
export function markBuyerNotificationRead(id: string) {
  return req<{ status: string }>(`/api/v1/notifications/buyer/${id}/read`, { method: 'POST' });
}
export function markAllBuyerNotificationsRead() {
  return req<{ status: string; updated: number }>(`/api/v1/notifications/buyer/read-all`, { method: 'POST' });
}
export function deleteBuyerNotification(id: string) {
  return req<{ status: string }>(`/api/v1/notifications/buyer/${id}`, { method: 'DELETE' });
}
export function clearAllBuyerNotifications() {
  return req<{ status: string; deleted: number }>(`/api/v1/notifications/buyer`, { method: 'DELETE' });
}

/**
 * Right-to-be-forgotten. Deletes the calling buyer's account and every
 * server-side row that references them (offers, ratings, notifications).
 * IRREVERSIBLE. Caller MUST sign out immediately after a 200 response.
 */
export function deleteMyBuyerAccount() {
  return req<{ status: 'deleted'; id: string }>(
    `/api/v1/buyers/me`,
    { method: 'DELETE' },
  );
}

/**
 * Backend serializes naive UTC datetimes (no 'Z' suffix); JS Date would
 * mis-parse those as local time — off by IST offset (~5.5h). Force UTC.
 */
export function parseServerTs(iso: string): number {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : iso + 'Z').getTime();
}

/** Bilingual "N ago" helper for freshness pills. */
export function ageLabel(iso: string): { en: string; kn: string } {
  const s = Math.max(0, Math.round((Date.now() - parseServerTs(iso)) / 1000));
  if (s < 60)   return { en: 'just now', kn: 'ಈಗಷ್ಟೇ' };
  if (s < 3600) { const m = Math.round(s / 60);   return { en: `${m} min ago`, kn: `${m} ನಿಮಿಷ ಹಿಂದೆ` }; }
  if (s < 86400){ const h = Math.round(s / 3600); return { en: `${h} h ago`,   kn: `${h} ಗಂಟೆ ಹಿಂದೆ` }; }
  const d = Math.round(s / 86400);
  return { en: `${d}d ago`, kn: `${d} ದಿನ ಹಿಂದೆ` };
}
