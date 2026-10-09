/**
 * Centralized API client for KisanShakti backend.
 *
 * Every request degrades gracefully: on network failure we return `null`
 * (or the caller-provided fallback), so screens can still render offline
 * from local SQLite cache.
 */
import { getFarmerProfile } from './local-db';

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://kisanshakti-backend.onrender.com';

async function authHeader(): Promise<Record<string, string>> {
  try {
    const p = await getFarmerProfile();
    return p?.auth_token ? { Authorization: `Bearer ${p.auth_token}` } : {};
  } catch {
    return {};
  }
}

async function req<T>(
  path: string,
  opts: RequestInit = {},
  fallback: T | null = null,
): Promise<T | null> {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(await authHeader()),
      ...(opts.headers ?? {}),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${API_BASE}${path}`, { ...opts, headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) {
      console.warn(`[api] ${path} → ${r.status}`);
      return fallback;
    }
    return (await r.json()) as T;
  } catch (e: any) {
    if (e?.name !== 'AbortError') console.warn(`[api] ${path} failed:`, e?.message);
    return fallback;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface MarketPrice {
  crop: string; kn: string; price: number; change: number;
  market: string; district?: string; variety?: string;
  arrival_date?: string; unit: string;
  /** Emoji glyph for the commodity — backend guarantees a fallback (🌱). */
  emoji?: string;
  /** km to farmer, when GPS provided and market coord known; else null */
  distance_km?: number | null;
  /** state the market sits in (from our APMC lookup) */
  market_state?: string;
}
export interface MarketPricesResponse {
  status: 'ok' | 'unavailable';
  source: string; state: string;
  district: string | null; market: string | null;
  commodity: string | null;
  count: number;
  note?: string | null;
  reason?: string;
  hint?: string;
  prices: MarketPrice[];
}
export interface WeatherData {
  source: string; location: string;
  temp_c: number; feels_like: number; humidity: number; wind_kmh: number;
  condition: string; condition_kn: string; icon: string; spray_ok: boolean;
  alert: { severity: string; title: string; title_kn: string; message: string; when: string } | null;
}
export interface Subsidy {
  id: string; title: string; title_kn: string; amount_inr: number;
  description: string; eligibility: string; apply_url: string;
  state: string; deadline: string;
}
export interface IrrigationInsight {
  level: 'low' | 'medium' | 'high';
  title: string; title_kn: string; message: string;
  soil_moisture: number | null; sensor_connected: boolean;
  based_on: { temp_c: number; humidity: number; condition: string; rain_forecast?: boolean };
}

// New: full agri-advisory bundle (irrigation + fungal risk + spray window)
export type WeatherKind = 'sunny' | 'partly' | 'cloudy' | 'rain' | 'thunder';

export interface ForecastDay {
  date: string;
  day_en: string; day_kn: string;
  high_c: number | null; low_c: number | null;
  rain_pct: number; rain_mm: number; wind_kmh: number;
  kind: WeatherKind;
  condition: string; condition_kn: string;
}

export interface ForecastResponse {
  status: 'ok' | 'unavailable';
  source: string;
  location?: { lat: number; lon: number };
  days: ForecastDay[];
  next_24h_rain_pct: number | null;
  next_24h_rain_mm:  number | null;
  current?: {
    temp_c: number; humidity: number; wind_kmh: number;
    condition: string; condition_kn: string;
    kind: WeatherKind;
  } | null;
  error?: string;
}

export interface AgriAdvisory {
  irrigation: {
    level: 'low' | 'medium' | 'high';
    title: string; title_kn: string;
    message: string; message_kn: string;
  };
  fungal: {
    level: 'low' | 'medium' | 'high';
    title: string; title_kn: string;
    message: string; message_kn: string;
  };
  spray: {
    ok: boolean;
    title: string; title_kn: string;
    message: string; message_kn: string;
    // Concrete best 3-hour window (when we could find one). Null when the
    // spray section is showing a generic message or when spray.ok=false.
    best_window: {
      start_iso: string;
      end_iso:   string;
      mean_wind_kmh: number;
      max_rain_prob: number;
    } | null;
  };
  soil_moisture: number | null;
  sensor_connected: boolean;
  based_on: {
    temp_c: number; humidity: number; condition: string; wind_kmh: number;
    next_24h_rain_pct: number | null; next_24h_rain_mm: number | null;
    sensor_temp_used: boolean; sensor_humidity_used: boolean;
  };
  // Populated only when the client passes farmer_id AND the farmer has an
  // active GROWING crop cycle logged. Null otherwise.
  crop_context: {
    crop_name:         string;
    crop_name_kn:      string | null;
    sowing_date:       string;   // ISO date
    days_since_sowing: number;
    stage:             'pre-sowing' | 'seedling' | 'vegetative' | 'flowering' | 'maturity';
    stage_kn:          string;
  } | null;
}

// ── Public API ─────────────────────────────────────────────────────────────
export interface DistrictNode {
  name:  string;
  apmcs: string[];
}
export interface StateNode {
  name:      string;
  districts: DistrictNode[];
}
export interface DistrictsResponse {
  states: StateNode[];
}

/** Load the state→district→APMC hierarchy for the search-screen dropdowns. */
export function fetchDistricts(state?: string) {
  const p = new URLSearchParams();
  if (state) p.set('state', state);
  const qs = p.toString();
  return req<DistrictsResponse>(`/api/v1/market/districts${qs ? '?' + qs : ''}`);
}

export function fetchMarketPrices(opts: {
  state?: string;
  district?: string | null;
  market?: string | null;
  commodity?: string | null;
  limit?: number;
  /** 'kmv' (default, KA-accurate) | 'data_gov' (national AGMARKNET). */
  source?: 'kmv' | 'data_gov';
  /** Farmer GPS — enables proximity ranking on the backend. */
  lat?: number | null;
  lon?: number | null;
  /**
   * 'nearest' (default): top-20 APMCs within 300km of (lat,lon).
   * 'state':   all markets in the current state, no distance cap.
   * 'all_india': entire data.gov.in national feed (search "All Karnataka" chip).
   */
  scope?: 'nearest' | 'state' | 'all_india';
} = {}) {
  const p = new URLSearchParams();
  p.set('state',  opts.state  ?? 'Karnataka');
  p.set('limit',  String(opts.limit ?? 50));
  p.set('source', opts.source ?? 'kmv');
  p.set('scope',  opts.scope  ?? 'nearest');
  if (opts.district)  p.set('district', opts.district);
  if (opts.market)    p.set('market', opts.market);
  if (opts.commodity) p.set('commodity', opts.commodity);
  if (opts.lat !== undefined && opts.lat !== null) p.set('lat', String(opts.lat));
  if (opts.lon !== undefined && opts.lon !== null) p.set('lon', String(opts.lon));
  return req<MarketPricesResponse>(`/api/v1/market/prices?${p.toString()}`);
}

export function fetchWeather(lat: number, lon: number) {
  return req<WeatherData>(`/api/v1/weather/current?lat=${lat}&lon=${lon}`);
}

export function fetchSubsidies(state?: string) {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  return req<{ count: number; items: Subsidy[] }>(`/api/v1/subsidies${qs}`);
}

export function fetchIrrigation(lat: number, lon: number, soilMoisture?: number) {
  const sm = soilMoisture != null ? `&soil_moisture=${soilMoisture}` : '';
  return req<IrrigationInsight>(`/api/v1/insights/irrigation?lat=${lat}&lon=${lon}${sm}`);
}

export function fetchForecast(lat: number, lon: number, days = 7) {
  return req<ForecastResponse>(`/api/v1/weather/forecast?lat=${lat}&lon=${lon}&days=${days}`);
}

export interface RainDiaryDay {
  date:    string;   // ISO date
  day_en:  string;
  day_kn:  string;
  rain_mm: number;
  is_past: boolean;
  is_today: boolean;
}

export interface RainDiaryResponse {
  status: 'ok' | 'unavailable';
  days:   RainDiaryDay[];
  past_total_mm:   number | null;
  future_total_mm: number | null;
}

/** Past N + future M days of precipitation totals — powers the rain-diary strip. */
export function fetchRainDiary(lat: number, lon: number, past = 7, future = 7) {
  return req<RainDiaryResponse>(
    `/api/v1/weather/rain-diary?lat=${lat}&lon=${lon}&past=${past}&future=${future}`
  );
}

// ── Cloud-persisted sensor readings (Phase 2) ────────────────────────────
// Used when the ESP32 is out of BLE range but still pushing over WiFi.

export interface SensorReadingCloud {
  id:            string;
  device_id:     string;
  farmer_id:     string | null;
  ts:            string;          // ISO timestamp (UTC)
  age_seconds:   number;          // freshness — how old this reading is right now
  soil_moisture: number | null;
  temperature:   number | null;
  humidity:      number | null;
  is_raining:    boolean | null;
  // Optional battery telemetry. null when USB-powered or when the firmware
  // has no voltage-divider circuit wired to the battery pin — the UI hides
  // the battery indicator in that case.
  battery_v:     number | null;
  battery_pct:   number | null;
  source:        string;
}

export interface SensorDevice {
  device_id:     string;
  label:         string | null;
  registered_at: string;
  last_seen_at:  string | null;
  age_seconds:   number | null;
}

/**
 * Latest single reading for the calling farmer (or one of their devices).
 * Returns null when no readings exist yet.
 *
 * The backend now derives farmer_id from the JWT — the `farmerId` opt is
 * accepted only for backward compatibility and is silently ignored on
 * the wire. `deviceId` is checked server-side to belong to the caller.
 */
export function fetchSensorLatest(opts: { farmerId?: string; deviceId?: string }) {
  const p = new URLSearchParams();
  if (opts.deviceId) p.set('device_id', opts.deviceId);
  const qs = p.toString();
  return req<SensorReadingCloud | null>(`/api/v1/sensor/latest${qs ? '?' + qs : ''}`);
}

/** Recent history for the trend graph. Default 24 h, max 168 h (7 days). JWT-scoped. */
export function fetchSensorHistory(opts: { farmerId?: string; deviceId?: string; hours?: number }) {
  const p = new URLSearchParams();
  if (opts.deviceId) p.set('device_id', opts.deviceId);
  p.set('hours', String(opts.hours ?? 24));
  return req<SensorReadingCloud[]>(`/api/v1/sensor/history?${p.toString()}`);
}

/** All ESP32 kits paired to the caller. JWT-scoped (farmerId arg unused, kept for API compat). */
export function fetchSensorDevices(_farmerId?: string) {
  return req<SensorDevice[]>(`/api/v1/sensor/devices`);
}

/**
 * Rename a paired sensor or bind it to a farmer. Called from the
 * pair-wizard so the sensor has its friendly nickname before its first
 * cloud POST — and from the device switcher for later renames.
 * Auto-creates the device row if it doesn't exist yet.
 */
export function updateSensorDevice(deviceId: string, opts: { label?: string }) {
  // farmer_id is derived from the JWT server-side; sending it is a no-op
  // and would be ignored anyway. Keeping the signature narrow prevents
  // accidental cross-farmer claims from callers.
  //
  // The response returns device_token — a per-device secret the app must
  // relay to the ESP32 over BLE so subsequent /reading POSTs authenticate.
  // Never persist this token in AsyncStorage or ship it anywhere else.
  return req<{
    device_id:    string;
    label:        string | null;
    farmer_id:    string | null;
    device_token: string | null;
  }>(
    `/api/v1/sensor/devices/${encodeURIComponent(deviceId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ...(opts.label !== undefined ? { label: opts.label } : {}),
      }),
    },
  );
}

/**
 * Build the JSON payload the ESP32 expects over the BLE characteristic.
 * Any field left undefined preserves the ESP32's existing NVS value, so
 * this same helper works for both first-time pair (all fields) and later
 * WiFi-only updates (just ssid + pass).
 *
 * IMPORTANT: `url` must be reachable from the ESP32's WiFi network — that
 * means the public backend URL in production, not the phone's localhost.
 */
export function buildSensorConfigJson(opts: {
  ssid?: string;                                              // legacy shortcut → slot 0
  pass?: string;
  networks?: { ssid: string; pass: string }[];                // full priority list (up to 3)
  url?: string;         // backend base URL, e.g. https://api.kisanshakti.example.com
  deviceId?: string;    // optional — ESP32 auto-assigns one from MAC if omitted
  farmerId?: string;    // the logged-in farmer's UUID (from /me)
  deviceToken?: string; // per-device auth secret (received from PATCH /devices/{id})
}): string {
  const doc: Record<string, any> = {};
  if (opts.networks && opts.networks.length > 0) {
    // Trim empty ssids so a farmer can leave later slots blank in the UI
    // without wiping saved slots on the ESP32 they didn't intend to touch.
    doc.networks = opts.networks.filter(n => n.ssid && n.ssid.trim().length > 0);
  } else {
    if (opts.ssid != null) doc.ssid = opts.ssid;
    if (opts.pass != null) doc.pass = opts.pass;
  }
  if (opts.url         != null) doc.url = opts.url;
  if (opts.deviceId    != null) doc.dev = opts.deviceId;
  if (opts.farmerId    != null) doc.fid = opts.farmerId;
  if (opts.deviceToken != null) doc.tok = opts.deviceToken;
  return JSON.stringify(doc);
}

/** Convert age_seconds → human-friendly bilingual string. */
export function ageLabel(seconds: number): { en: string; kn: string } {
  if (seconds < 60)   return { en: 'just now',                kn: 'ಈಗಷ್ಟೇ' };
  if (seconds < 3600) return { en: `${Math.round(seconds/60)} min ago`, kn: `${Math.round(seconds/60)} ನಿಮಿಷ ಹಿಂದೆ` };
  if (seconds < 86400) {
    const h = Math.round(seconds/3600);
    return { en: `${h} h ago`, kn: `${h} ಗಂಟೆ ಹಿಂದೆ` };
  }
  const d = Math.round(seconds/86400);
  return { en: `${d}d ago`, kn: `${d} ದಿನ ಹಿಂದೆ` };
}

/**
 * Full agri-advisory. Pass ESP32 sensor values when connected; the backend
 * uses them to sharpen the recommendation.
 */
export function fetchAgriAdvisory(opts: {
  lat: number; lon: number;
  soilMoisture?: number;
  sensorTemp?: number;
  sensorHumidity?: number;
  sensorIsRaining?: boolean;
  farmerId?: string;      // Optional — when passed, backend tunes advice to the farmer's active crop stage
}) {
  const p = new URLSearchParams();
  p.set('lat', String(opts.lat));
  p.set('lon', String(opts.lon));
  if (opts.soilMoisture     != null) p.set('soil_moisture',     String(opts.soilMoisture));
  if (opts.sensorTemp       != null) p.set('sensor_temp',       String(opts.sensorTemp));
  if (opts.sensorHumidity   != null) p.set('sensor_humidity',   String(opts.sensorHumidity));
  if (opts.sensorIsRaining  != null) p.set('sensor_is_raining', String(opts.sensorIsRaining));
  if (opts.farmerId)                 p.set('farmer_id',         opts.farmerId);
  return req<AgriAdvisory>(`/api/v1/insights/irrigation?${p.toString()}`);
}

// ── Farm Business Overview / Generational BI ───────────────────────────────
// All endpoints under /api/v1/bi/. See backend/bi_endpoints.py for the
// server-side implementation and backend/bi/calculations.py for the math.

export type CycleStatus = 'PLANNED' | 'GROWING' | 'HARVESTED' | 'ABANDONED';

export interface Plot {
  id:                 string;
  label:              string;
  label_kn:           string | null;
  area_ha:            number;
  latitude:           number | null;
  longitude:          number | null;
  soil_type:          string | null;
  created_at:         string;
  active_cycle:       CropCycle | null;
  last_completed_roi: number | null;
  cycles_count:       number;
}

export interface CropCycle {
  id:                    string;
  plot_id:               string;
  plot_label?:           string | null;
  crop_name:             string;
  crop_name_kn:          string | null;
  sowing_date:           string;      // YYYY-MM-DD
  expected_harvest_date: string | null;
  actual_harvest_date:   string | null;
  status:                CycleStatus;
  total_revenue:         number;
  total_expenses:        number;
  net_profit:            number | null;   // null until HARVESTED
  roi_percent:           number | null;   // null when expenses=0 OR not harvested
  notes:                 string | null;
  logged_by_farmer_id:   string;
}

export interface Recommendation {
  crop_name:       string;
  crop_name_kn:    string | null;
  avg_roi:         number;
  min_roi:         number;
  max_roi:         number;
  seasons_tracked: number;
  variable:        boolean;      // true = "high average but risky"
}

export interface RecommendationResponse {
  status:          'ok' | 'insufficient_data';
  recommendations: Recommendation[];
  reason?:         string;
  near_hits?:      number;
}

export interface YearPoint {
  year:              number;
  roi_percent:       number | null;
  net_profit:        number;
  avg_temp_c:        number | null;
  total_rainfall_mm: number | null;
}

export interface PlotSummary {
  plot_id:             string;
  plot_label:          string;
  plot_label_kn:       string | null;
  area_ha:             number;
  total_cycles:        number;
  harvested_cycles:    number;
  current_year:        number;
  current_year_profit: number;
  best_crop:  { crop_name: string; crop_name_kn: string | null; roi_percent: number; year: number | null } | null;
  worst_crop: { crop_name: string; crop_name_kn: string | null; roi_percent: number; year: number | null } | null;
}

export function fetchPlots() {
  return req<Plot[]>(`/api/v1/bi/plots`);
}

export interface HomeStats {
  plots_count:      number;
  cycles_count:     number;
  crop_types_count: number;
  crop_types:       string[];
}

/** Aggregate stats for the Home page chips. Derived from plots+cycles the
 *  farmer has logged in the Business tab — no separate crop list to maintain. */
export function fetchHomeStats() {
  return req<HomeStats>(`/api/v1/bi/home-stats`);
}

// ── Notifications ──────────────────────────────────────────────────────────

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

export function fetchFarmerNotifications() {
  return req<NotificationsFeed>(`/api/v1/notifications/farmer`);
}
export function markFarmerNotificationRead(id: string) {
  return req<{ status: string }>(`/api/v1/notifications/farmer/${id}/read`, { method: 'POST' });
}
export function markAllFarmerNotificationsRead() {
  return req<{ status: string; updated: number }>(`/api/v1/notifications/farmer/read-all`, { method: 'POST' });
}

/** Delete a single notification permanently. */
export function deleteFarmerNotification(id: string) {
  return req<{ status: string }>(`/api/v1/notifications/farmer/${id}`, { method: 'DELETE' });
}

/** Clear the entire farmer feed (nuke). */
export function clearAllFarmerNotifications() {
  return req<{ status: string; deleted: number }>(`/api/v1/notifications/farmer`, { method: 'DELETE' });
}

export function createPlot(body: {
  label: string; label_kn?: string | null;
  area_ha: number; latitude?: number | null; longitude?: number | null;
  soil_type?: string | null;
}) {
  return req<Plot>(`/api/v1/bi/plots`, { method: 'POST', body: JSON.stringify(body) });
}

export function updatePlot(plotId: string, body: {
  label: string; label_kn?: string | null;
  area_ha: number; latitude?: number | null; longitude?: number | null;
  soil_type?: string | null;
}) {
  return req<Plot>(`/api/v1/bi/plots/${plotId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function fetchCycles(plotId: string) {
  return req<CropCycle[]>(`/api/v1/bi/plots/${plotId}/cycles`);
}

/**
 * Delete a plot. If the plot has any cycles, backend returns 409 unless
 * confirm='DELETE' is passed — the frontend must show a "type DELETE to
 * confirm" dialog before calling with confirm.
 */
export function deletePlot(plotId: string, opts: { confirm?: 'DELETE' } = {}) {
  const q = opts.confirm ? `?confirm=${opts.confirm}` : '';
  return req<{ status: string; cycles_removed: number }>(
    `/api/v1/bi/plots/${plotId}${q}`,
    { method: 'DELETE' },
  );
}

export function createCycle(plotId: string, body: {
  crop_name: string; crop_name_kn?: string | null;
  sowing_date: string; expected_harvest_date?: string | null;
  notes?: string | null;
}) {
  return req<CropCycle>(`/api/v1/bi/plots/${plotId}/cycles`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function updateCycle(cycleId: string, body: {
  crop_name?: string; crop_name_kn?: string | null;
  sowing_date?: string; expected_harvest_date?: string | null;
  notes?: string | null;
  status?: CycleStatus;
}) {
  return req<CropCycle>(`/api/v1/bi/cycles/${cycleId}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

export function addCycleEntry(cycleId: string, body: {
  kind: 'INCOME' | 'EXPENSE';
  amount: number;
  subcategory: string;
  note?: string | null;
}) {
  return req<CropCycle>(`/api/v1/bi/cycles/${cycleId}/entries`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function markCycleHarvested(cycleId: string) {
  return req<CropCycle>(`/api/v1/bi/cycles/${cycleId}/harvest`, { method: 'POST' });
}

export function fetchRecommendations(plotId: string, month: number) {
  return req<RecommendationResponse>(`/api/v1/bi/plots/${plotId}/recommendations?month=${month}`);
}

export function fetchYoYHistory(plotId: string, cropName: string) {
  return req<YearPoint[]>(
    `/api/v1/bi/plots/${plotId}/history/${encodeURIComponent(cropName)}`,
  );
}

export function fetchPlotSummary(plotId: string) {
  return req<PlotSummary>(`/api/v1/bi/plots/${plotId}/summary`);
}

export function initPlotTransfer(plotId: string, reason: 'INHERITANCE' | 'SALE' = 'INHERITANCE') {
  return req<{ claim_code: string; expires_in_seconds: number; plot_label: string }>(
    `/api/v1/bi/plots/${plotId}/transfer/init`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

export function acceptPlotTransfer(claimCode: string) {
  return req<{ status: string; plot_id: string; plot_label: string }>(
    `/api/v1/bi/plots/transfer/accept`,
    { method: 'POST', body: JSON.stringify({ claim_code: claimCode.toUpperCase() }) },
  );
}

export function fetchOwnershipHistory(plotId: string) {
  return req<Array<{
    farmer_id: string; transferred_from: string | null;
    transferred_at: string; reason: string;
  }>>(`/api/v1/bi/plots/${plotId}/ownership-history`);
}

// ── Hyperlocal Commerce Engine ─────────────────────────────────────────────
// Listings the farmer posts + counter-offers buyers submit against them.
// See backend/commerce_endpoints.py for the server side.

// EXPIRED was added Sep 2026 when the per-crop shelf-life sweep landed.
// Backend flips AVAILABLE → EXPIRED once expires_at passes. Present in
// responses when the caller passes ?include_expired=true.
export type CommerceListingStatus = 'AVAILABLE' | 'LOCKED' | 'SOLD' | 'EXPIRED';
export type OfferStatus =
  | 'PENDING' | 'ACCEPTED' | 'IN_DELIVERY' | 'COMPLETED'
  | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED' | 'CANCELLED';

export interface OfferSummary {
  id:                   string;
  offered_price_per_kg: number;
  quantity_kg:          number;
  buyer_shop_name:      string | null;
  status:               OfferStatus;
  created_at:           string;
}

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
  status:           CommerceListingStatus;
  latitude:         number;
  longitude:        number;
  distance_km:      number | null;
  benchmark_price:  number | null;
  price_verified:   boolean;
  fair_price:       boolean;
  photo_url:            string | null;          // /uploads/... — resolve with API_BASE
  photos:               { id: string; url: string }[]; // ordered, primary first (photo_url == photos[0].url)
  village:              string | null;          // reverse-geocoded on create
  farmer_rating:        number | null;          // avg stars (1dp), null if never rated
  farmer_rating_count:  number;                 // total completed-sale ratings received
  pending_offers_count: number;                 // 0 for buyer-side responses
  latest_offer:         OfferSummary | null;    // null when no offers yet
  // Auto-price-fit provenance — set when farmer used /pricing/suggest.
  market_source_apmc:        string | null;
  market_source_district:    string | null;
  market_source_price_kg:    number | null;
  market_source_distance_km: number | null;
  market_source_date:        string | null;
  created_at:       string;
  expires_at:       string | null;
}

/** Resolve a relative photo_url (starts with "/uploads/") into a full URL
 *  the RN Image component can load. */
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
  delivery_otp:         string | null;       // present only during IN_DELIVERY
  completed_at:         string | null;
  cancelled_reason:     string | null;
  rated:                boolean;              // buyer has already rated the farmer on this offer
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

/**
 * Farmer creates a listing. Backend hard-validates price against ±5% of the
 * AGMARKNET benchmark and returns 400 with floor/ceiling if out of range —
 * the UI should show that inline, not swallow it.
 */
export function createCommerceListing(body: {
  crop_name: string; crop_name_kn?: string | null;
  quantity_kg: number; price_per_kg: number;
  latitude: number; longitude: number;
  plot_id?: string | null; cycle_id?: string | null;
  district?: string | null; expires_in_days?: number;
  // Auto-price-fit snapshot from /pricing/suggest — forwarded through so
  // the buyer can see "Fitted from Bangarpet APMC · 13 km".
  market_source_apmc?:        string | null;
  market_source_district?:    string | null;
  market_source_price_kg?:    number | null;
  market_source_distance_km?: number | null;
  market_source_date?:        string | null;
}) {
  return req<CommerceListing>(`/api/v1/listings`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

// ── Auto-APMC price suggestion (replaces old /pricing/smart-price) ────────

export interface PriceSuggestion {
  status: 'ok' | 'unavailable';
  crop:   string;
  suggested_price_kg?: number;
  min_price_kg?:       number | null;
  max_price_kg?:       number | null;
  apmc?: {
    name:        string;
    district:    string;
    state:       string;
    distance_km: number;
  };
  source?:       'kmv' | 'agmarknet';
  arrival_date?: string | null;
  hop_count?:    number;
  reason?:       string;
  hint?:         string;
}

/** Fit a suggested price by walking outward from farmer's GPS. */
export function fetchPriceSuggestion(opts: {
  crop: string; lat: number; lon: number; maxKm?: number;
}) {
  const p = new URLSearchParams({
    crop:   opts.crop,
    lat:    String(opts.lat),
    lon:    String(opts.lon),
    max_km: String(opts.maxKm ?? 300),
  });
  return req<PriceSuggestion>(`/api/v1/pricing/suggest?${p.toString()}`);
}

export function updateCommerceListing(id: string, body: {
  price_per_kg?: number; quantity_kg?: number;
  status?: CommerceListingStatus; district?: string;
}) {
  return req<CommerceListing>(`/api/v1/listings/${id}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });
}

/**
 * Farmer's own listings — powers the "My Listings" screen.
 * By default the backend excludes EXPIRED rows (shelf-life auto-sweep)
 * so they don't pollute the Active/Orders/Delivery tabs. Pass
 * `{ includeExpired: true }` for the "Past listings" history view.
 */
export function fetchMyListings(opts?: { includeExpired?: boolean }) {
  const qs = opts?.includeExpired ? '?include_expired=true' : '';
  return req<CommerceListing[]>(`/api/v1/listings${qs}`);
}

/** Hard-delete a listing (farmer-owned only). Cascades any attached offers. */
export function deleteCommerceListing(id: string) {
  return req<{ status: string; listing_id: string }>(
    `/api/v1/listings/${id}`,
    { method: 'DELETE' },
  );
}

/**
 * Upload / replace the photo on a listing. `photoUri` is a local file:// URI
 * returned by expo-image-picker (already compressed via expo-image-manipulator
 * on the client to keep payload small).
 *
 * Uses raw fetch (bypasses the `req` JSON wrapper) because multipart uploads
 * need their own Content-Type boundary managed by the runtime.
 */
export async function uploadListingPhoto(
  listingId: string,
  photoUri: string,
): Promise<CommerceListing | null> {
  console.log('[upload] starting → listing', listingId, 'uri', photoUri);
  try {
    // Expo SDK 57 tightened FormData — the classic RN `{uri, name, type}`
    // FormData part now throws "Unsupported FormDataPart implementation".
    // Fetch the file into a Blob first, then append that.
    let uri = photoUri;
    if (uri.startsWith('content://')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FS = require('expo-file-system/legacy');
        const target = `${FS.cacheDirectory}upload_${listingId}.jpg`;
        await FS.copyAsync({ from: uri, to: target });
        uri = target;
        console.log('[upload] copied content:// → file://', target);
      } catch (copyErr: any) {
        console.warn('[upload] could not normalise content:// URI', copyErr?.message);
      }
    }

    // Read the file bytes. Two paths:
    //   1. fetch(fileUri).blob() — works on modern RN, cleanest.
    //   2. Fallback via expo-file-system readAsStringAsync + base64 → Blob.
    let blob: Blob | null = null;
    try {
      const r1 = await fetch(uri);
      blob = await r1.blob();
      console.log('[upload] blob ready, size', (blob as any).size, 'type', (blob as any).type);
    } catch (fetchErr: any) {
      console.warn('[upload] fetch(uri).blob() failed:', fetchErr?.message);
    }
    if (!blob || (blob as any).size === 0) {
      // Fallback path — read as base64 via expo-file-system, wrap in Blob
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FS = require('expo-file-system/legacy');
        const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: 'image/jpeg' });
        console.log('[upload] fallback blob ready, size', blob.size);
      } catch (fbErr: any) {
        console.warn('[upload] fallback blob failed:', fbErr?.message);
        return null;
      }
    }

    const form = new FormData();
    // Standard web-style FormData part. RN in SDK 57 accepts a Blob as the
    // second arg with an optional filename as the third — matches the DOM
    // FormData contract browsers use.
    form.append('file', blob as any, `listing_${listingId}.jpg`);

    const headers: Record<string, string> = { ...(await authHeader()) };
    console.log('[upload] POST', `${API_BASE}/api/v1/listings/${listingId}/photo`);
    const r = await fetch(`${API_BASE}/api/v1/listings/${listingId}/photo`, {
      method: 'POST',
      headers,
      body:   form,
    });
    console.log('[upload] response status', r.status);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.warn(`[upload] failed ${r.status}:`, text.slice(0, 200));
      return null;
    }
    const json = (await r.json()) as CommerceListing;
    console.log('[upload] OK — photo_url', json.photo_url);
    return json;
  } catch (e: any) {
    console.warn('[upload] exception:', e?.message ?? e);
    return null;
  }
}

/**
 * Append an ADDITIONAL photo to a listing (beyond the primary). Backend
 * rejects with 400 if the listing already has the max (5). Reuses the same
 * blob-normalisation dance as uploadListingPhoto — the only difference is
 * the endpoint path (POST /photos, plural).
 */
export async function appendListingPhoto(
  listingId: string,
  photoUri: string,
): Promise<CommerceListing | null> {
  try {
    let uri = photoUri;
    if (uri.startsWith('content://')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FS = require('expo-file-system/legacy');
        const target = `${FS.cacheDirectory}upload_extra_${Date.now()}.jpg`;
        await FS.copyAsync({ from: uri, to: target });
        uri = target;
      } catch {}
    }
    let blob: Blob | null = null;
    try {
      const r1 = await fetch(uri);
      blob = await r1.blob();
    } catch {}
    if (!blob || (blob as any).size === 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const FS = require('expo-file-system/legacy');
        const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: 'image/jpeg' });
      } catch { return null; }
    }
    const form = new FormData();
    form.append('file', blob as any, `listing_${listingId}_${Date.now()}.jpg`);
    const headers: Record<string, string> = { ...(await authHeader()) };
    const r = await fetch(`${API_BASE}/api/v1/listings/${listingId}/photos`, {
      method: 'POST', headers, body: form,
    });
    if (!r.ok) return null;
    return (await r.json()) as CommerceListing;
  } catch { return null; }
}

/** Remove one photo from a listing (photoId from CommerceListing.photos[i].id). */
export function deleteListingPhoto(listingId: string, photoId: string) {
  return req<CommerceListing>(
    `/api/v1/listings/${listingId}/photos/${photoId}`,
    { method: 'DELETE' },
  );
}

/** Buyer rates the farmer after a delivery completes. 1-5 stars. */
export function rateFarmer(offerId: string, stars: number, comment?: string) {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}/rate`, {
    method: 'POST',
    body: JSON.stringify({ stars, comment: comment ?? null }),
  });
}

/** Offers received on a specific listing — for the farmer's inbox. */
export function fetchOffersForListing(listingId: string) {
  return req<CommerceOffer[]>(`/api/v1/listings/${listingId}/offers`);
}

export function respondToOffer(offerId: string, action: 'ACCEPT' | 'REJECT') {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}`, {
    method: 'PATCH', body: JSON.stringify({ action }),
  });
}

/**
 * Farmer types the OTP the BUYER shared on physical delivery. On match:
 * backend flips COMPLETED, listing qty decrements, income posts to plot.
 * Only the buyer knows the OTP — farmer must ask on handover.
 */
export function verifyDeliveryOtp(offerId: string, otp: string) {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}/verify-otp`, {
    method: 'POST', body: JSON.stringify({ otp }),
  });
}

/** Farmer bypass when buyer forgot the OTP. Sends a "manually confirmed"
 *  notification to the buyer. */
export function completeDeliveryManual(offerId: string) {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}/complete-manual`, {
    method: 'POST', body: JSON.stringify({ confirm: true }),
  });
}

/** Farmer cancels an in-delivery order (truck broke down, etc). Buyer sees
 *  the reason on their side. */
export function cancelDelivery(offerId: string, reason: string) {
  return req<CommerceOffer>(`/api/v1/offers/${offerId}/cancel-delivery`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

/** Live AGMARKNET-backed price hint. Used by the create-listing screen to
 *  show "Fair range today: ₹18–₹20/kg" as the farmer types. */
export function fetchPriceBenchmark(cropName: string, district: string) {
  return req<PriceBenchmark>(
    `/api/v1/price-benchmarks/${encodeURIComponent(cropName)}/${encodeURIComponent(district)}`,
  );
}

// ── Mandi-app-only helpers (kept in shared api.ts for parity) ─────────────

export function searchNearbyListings(opts: {
  lat: number; lng: number; radiusKm?: number; crop?: string; limit?: number;
}) {
  const p = new URLSearchParams();
  p.set('lat', String(opts.lat));
  p.set('lng', String(opts.lng));
  p.set('radius_km', String(opts.radiusKm ?? 25));
  if (opts.crop)  p.set('crop', opts.crop);
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

export function fetchMyOffers()  { return req<CommerceOffer[]>(`/api/v1/offers/mine`);   }
export function fetchMyOrders()  { return req<CommerceOffer[]>(`/api/v1/offers/orders`); }

export function updateFarmerProfile(body: {
  full_name?: string;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  total_land_ha?: number;
  cattle_count?: number;
  crops?: Array<{ crop_name: string; crop_name_kn?: string | null; land_ha: number }>;
}) {
  return req<{ status: string; id: string }>(
    `/api/v1/farmers/profile`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

/**
 * Right-to-be-forgotten. Deletes the calling farmer's account and every
 * server-side row that references them (listings, offers, ratings, plots,
 * cycles, ledger, sensor devices/readings, notifications, crops).
 * IRREVERSIBLE. Caller MUST sign out immediately after a 200 response.
 */
export function deleteMyFarmerAccount() {
  return req<{ status: 'deleted'; id: string }>(
    `/api/v1/farmers/me`,
    { method: 'DELETE' },
  );
}
