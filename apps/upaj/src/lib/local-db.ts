/**
 * Local SQLite database — offline-first store for farmer profile, crops,
 * and ledger cache. This is the source of truth on device; server sync
 * happens opportunistically when internet is available.
 *
 * All reads/writes happen through `getDB()` which lazily opens & migrates
 * the DB on first access.
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'kisanshakti_local.db';
const DB_VERSION = 1;

let _db: SQLite.SQLiteDatabase | null = null;

// ── Schema ──────────────────────────────────────────────────────────────────
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS farmer_profile (
    id             TEXT PRIMARY KEY,
    server_id      TEXT,
    phone          TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    location_name  TEXT,
    latitude       REAL,
    longitude      REAL,
    total_land_ha  REAL DEFAULT 0,
    auth_token     TEXT,
    onboarded      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS farmer_crops (
    id            TEXT PRIMARY KEY,
    farmer_id     TEXT NOT NULL,
    crop_name     TEXT NOT NULL,
    crop_name_kn  TEXT,
    land_ha       REAL NOT NULL,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (farmer_id) REFERENCES farmer_profile(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_crops_farmer ON farmer_crops(farmer_id);

  CREATE TABLE IF NOT EXISTS ledger_cache (
    id              TEXT PRIMARY KEY,
    farmer_id       TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount          REAL NOT NULL,
    category        TEXT NOT NULL,
    timestamp       INTEGER NOT NULL,
    synced          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (farmer_id) REFERENCES farmer_profile(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_farmer ON ledger_cache(farmer_id);
  CREATE INDEX IF NOT EXISTS idx_ledger_unsynced ON ledger_cache(synced) WHERE synced = 0;
`;

// ── Types ───────────────────────────────────────────────────────────────────

export interface FarmerProfile {
  id: string;
  server_id: string | null;
  phone: string;
  name: string;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  total_land_ha: number;
  auth_token: string | null;
  onboarded: boolean;
  created_at: number;
  updated_at: number;
}

export interface FarmerCrop {
  id: string;
  farmer_id: string;
  crop_name: string;
  crop_name_kn: string | null;
  land_ha: number;
  created_at: number;
}

export interface LedgerEntry {
  id: string;
  farmer_id: string;
  transaction_type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  timestamp: number;
  synced: boolean;
}

// ── DB open + migrate ───────────────────────────────────────────────────────

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(SCHEMA);
  await db.runAsync(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`,
    [String(DB_VERSION)]
  );
  _db = db;
  return db;
}

export async function resetDB(): Promise<void> {
  const db = await getDB();
  await db.execAsync(`
    DELETE FROM farmer_crops;
    DELETE FROM ledger_cache;
    DELETE FROM farmer_profile;
  `);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function uuid(): string {
  // Fast RFC-4122 v4 UUID for local IDs
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now(): number { return Date.now(); }

// ── Farmer Profile ──────────────────────────────────────────────────────────

export async function getFarmerProfile(): Promise<FarmerProfile | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM farmer_profile ORDER BY updated_at DESC LIMIT 1`
  );
  if (!row) return null;
  return { ...row, onboarded: row.onboarded === 1 };
}

export async function upsertFarmerProfile(input: {
  id?: string;
  server_id?: string | null;
  phone: string;
  name?: string;
  location_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  total_land_ha?: number;
  auth_token?: string | null;
  onboarded?: boolean;
}): Promise<FarmerProfile> {
  const db = await getDB();
  const existing = await db.getFirstAsync<any>(
    `SELECT * FROM farmer_profile WHERE phone = ? LIMIT 1`,
    [input.phone]
  );

  // Coalesce: keep existing value when input omits the field OR passes empty string
  const keep = <T,>(v: T | undefined | null, fallback: T): T =>
    (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''))
      ? fallback : v;

  if (existing) {
    const merged = {
      server_id:     keep(input.server_id, existing.server_id),
      name:          keep(input.name, existing.name),
      location_name: keep(input.location_name, existing.location_name),
      latitude:      input.latitude ?? existing.latitude,
      longitude:     input.longitude ?? existing.longitude,
      total_land_ha: input.total_land_ha ?? existing.total_land_ha,
      auth_token:    keep(input.auth_token, existing.auth_token),
      onboarded:     input.onboarded === undefined ? existing.onboarded : (input.onboarded ? 1 : 0),
    };
    await db.runAsync(
      `UPDATE farmer_profile
       SET server_id=?, name=?, location_name=?, latitude=?, longitude=?,
           total_land_ha=?, auth_token=?, onboarded=?, updated_at=?
       WHERE id=?`,
      [merged.server_id, merged.name, merged.location_name, merged.latitude,
       merged.longitude, merged.total_land_ha, merged.auth_token, merged.onboarded,
       now(), existing.id]
    );
  } else {
    const id = input.id ?? uuid();
    await db.runAsync(
      `INSERT INTO farmer_profile
       (id, server_id, phone, name, location_name, latitude, longitude,
        total_land_ha, auth_token, onboarded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.server_id ?? null, input.phone, input.name ?? '',
       input.location_name ?? null, input.latitude ?? null, input.longitude ?? null,
       input.total_land_ha ?? 0, input.auth_token ?? null,
       input.onboarded ? 1 : 0, now(), now()]
    );
  }

  const result = await getFarmerProfile();
  if (!result) throw new Error('[local-db] upsert failed');
  return result;
}

export async function signOutLocal(): Promise<void> {
  const db = await getDB();
  await db.runAsync(`UPDATE farmer_profile SET auth_token = NULL`);
}

// ── Farmer Crops ────────────────────────────────────────────────────────────

export async function getFarmerCrops(farmerId: string): Promise<FarmerCrop[]> {
  const db = await getDB();
  return await db.getAllAsync<FarmerCrop>(
    `SELECT * FROM farmer_crops WHERE farmer_id = ? ORDER BY created_at ASC`,
    [farmerId]
  );
}

export async function addFarmerCrop(input: {
  farmer_id: string;
  crop_name: string;
  crop_name_kn?: string | null;
  land_ha: number;
}): Promise<FarmerCrop> {
  const db = await getDB();
  const id = uuid();
  await db.runAsync(
    `INSERT INTO farmer_crops (id, farmer_id, crop_name, crop_name_kn, land_ha, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.farmer_id, input.crop_name, input.crop_name_kn ?? null, input.land_ha, now()]
  );
  return { id, farmer_id: input.farmer_id, crop_name: input.crop_name,
           crop_name_kn: input.crop_name_kn ?? null, land_ha: input.land_ha, created_at: now() };
}

export async function deleteFarmerCrop(cropId: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(`DELETE FROM farmer_crops WHERE id = ?`, [cropId]);
}

export async function replaceFarmerCrops(farmerId: string, crops: Array<{
  crop_name: string; crop_name_kn?: string | null; land_ha: number;
}>): Promise<void> {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM farmer_crops WHERE farmer_id = ?`, [farmerId]);
    for (const c of crops) {
      await db.runAsync(
        `INSERT INTO farmer_crops (id, farmer_id, crop_name, crop_name_kn, land_ha, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuid(), farmerId, c.crop_name, c.crop_name_kn ?? null, c.land_ha, now()]
      );
    }
  });
}

// ── Ledger Cache ────────────────────────────────────────────────────────────

export async function getLedgerEntries(farmerId: string, limit = 50): Promise<LedgerEntry[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM ledger_cache WHERE farmer_id = ?
     ORDER BY timestamp DESC LIMIT ?`,
    [farmerId, limit]
  );
  return rows.map(r => ({ ...r, synced: r.synced === 1 }));
}

export async function addLedgerEntry(input: {
  farmer_id: string;
  transaction_type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  timestamp?: number;
  synced?: boolean;
}): Promise<LedgerEntry> {
  const db = await getDB();
  const id = uuid();
  const ts = input.timestamp ?? now();
  await db.runAsync(
    `INSERT INTO ledger_cache (id, farmer_id, transaction_type, amount, category, timestamp, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.farmer_id, input.transaction_type, input.amount, input.category, ts, input.synced ? 1 : 0]
  );
  return {
    id, farmer_id: input.farmer_id, transaction_type: input.transaction_type,
    amount: input.amount, category: input.category, timestamp: ts, synced: !!input.synced,
  };
}

export async function markLedgerSynced(id: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(`UPDATE ledger_cache SET synced = 1 WHERE id = ?`, [id]);
}
