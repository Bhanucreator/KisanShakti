/**
 * KisanShakti — Shared TypeScript Interfaces
 * Used by both apps/upaj and apps/mandi
 */

export type UUID = string;

// ─── Database Models ──────────────────────────────────────────────────────
export interface FarmerProfile {
  id: UUID;
  phone_number: string;
  full_name: string;
  total_land_ha: number;
  cattle_count?: number;
}

export interface BuyerProfile {
  id: UUID;
  phone_number: string;
  shop_name: string;
  shop_type: 'KIRANA' | 'RESTAURANT' | 'WHOLESALER' | 'CANTEEN';
  sourcing_radius_km: number;
}

export type CropStatus = 'AVAILABLE' | 'LOCKED' | 'SOLD';

export interface CropListing {
  id: UUID;
  farmer_id: UUID;
  crop_name: string;
  quantity_kg: number;
  calculated_price_per_kg: number;
  status: CropStatus;
  distance_km?: number;
  farmer_name?: string;
  farmer_phone?: string;
}

export type TransactionType = 'INCOME' | 'EXPENSE';

export interface FarmLedgerEntry {
  id: UUID;
  farmer_id: UUID;
  transaction_type: TransactionType;
  amount: number;
  category: string;
  timestamp: string;
}

// ─── API Request/Response Types ───────────────────────────────────────────
export interface SmartPriceRequest {
  crop_name: string;
  quality_modifier: number; // -0.05 to +0.05
}

export interface SmartPriceResponse {
  crop_name: string;
  smart_price: number;
}

export interface NearbyListingsRequest {
  latitude: number;
  longitude: number;
  radius_km: number;
}

export interface CreateListingRequest {
  crop_name: string;
  quantity_kg: number;
  calculated_price_per_kg: number;
  latitude?: number;
  longitude?: number;
}

// ─── ESP32 / BLE Types ────────────────────────────────────────────────────
export interface ESP32SensorData {
  soil_moisture: number;  // 0-100%
  temperature: number;    // °C
  humidity: number;       // 0-100%
  is_raining: boolean;
}

export interface HotspotCredentials {
  ssid: string;
  pass: string;
}

// ─── Disease Detection ────────────────────────────────────────────────────
export type Severity = 'Low' | 'Moderate' | 'High' | 'Critical';

export interface DiagnosticResult {
  disease: string;
  confidence: number;     // 0-100
  severity: Severity;
  organicTreatment: string;
  chemicalTreatment: string;
  kannada: string;
}

// ─── Buyer Preferences ────────────────────────────────────────────────────
export interface BuyerPreferences {
  shopType: BuyerProfile['shop_type'];
  radius: number;
  notifications: boolean;
}

// ─── Auth Types ───────────────────────────────────────────────────────────
export interface SendOTPRequest { phone: string; }
export interface SendOTPResponse { message: string; dev_otp?: string; }
export interface VerifyOTPRequest {
  phone: string;
  code: string;
  name?: string;
  shop_type?: BuyerProfile['shop_type'];
}
export interface VerifyOTPResponse {
  access_token: string;
  token_type: 'bearer';
  is_new_user: boolean;
  user_id: string;
  name: string | null;
  role: 'farmer' | 'buyer';
}
