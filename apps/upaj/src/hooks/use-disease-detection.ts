/**
 * useDiseaseDetection
 * ────────────────────
 * Real on-device inference for crop leaf disease detection.
 *
 * Pipeline per image:
 *   1. Resize to 224×224 JPEG (base64) via expo-image-manipulator
 *   2. Decode base64 JPEG → raw RGBA bytes (pure JS via jpeg-js)
 *   3. LEAF GATE — count green-dominant pixels; reject if < LEAF_MIN_RATIO
 *   4. Build [1,224,224,3] Uint8Array (model is uint8-quantised)
 *   5. TFLite MobileNetV2 inference → [1,5] uint8 → dequantise → probs
 *   6. CONFIDENCE GATE — argmax; if top prob < CONF_THRESHOLD → "low_confidence"
 *   7. Lookup treatment row in SQLite by class_id
 *
 * The bundled model classifies 5 classes: Healthy, Tomato Late Blight,
 * Tomato Early Blight, Potato Early Blight, Potato Late Blight.
 *
 * We never fabricate a diagnosis. When the image isn't a leaf, or the model
 * isn't confident, `runInference` returns a non-"ok" status and the UI shows
 * an honest empty state — never a guessed disease.
 *
 * Load contract: `react-native-fast-tflite` v3 verified against this app:
 *   - `loadTensorflowModel(source, [])` — 2nd arg MUST be an object (empty
 *     array counts as an object). Passing a string, undefined, or omitting
 *     the arg throws "Value is a string / undefined, expected an Object".
 *   - `model.runSync([inputBuffer])` — input MUST be an ArrayBuffer, NOT a
 *     TypedArray. Pass `typedArray.buffer`.
 *   - Output: `outputs[0]` is a TypedArray (uint8 for this model).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import * as SQLite from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Asset } from 'expo-asset';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jpeg = require('jpeg-js');

// ── Types ─────────────────────────────────────────────────────────────────────

export type InferenceStatus = 'ok' | 'not_a_leaf' | 'low_confidence' | 'error';

export type InferenceResult = {
  status: InferenceStatus;
  reason?: string;
  hint?: string;

  classIndex: number;
  classLabel: string;
  confidence: number;

  disease_name: string;
  scientific_name: string | null;
  severity: string;
  affected_crop: string;
  organic_treatment: string | null;
  organic_dosage: string | null;
  chemical_treatment: string | null;
  chemical_dosage: string | null;
  store_product: string | null;
  kannada_name: string | null;
  kannada_organic: string | null;
  kannada_chemical: string | null;
  prevention: string | null;

  leafScore: number;
  topProbs: { label: string; prob: number }[];
};

type DiseaseRow = {
  id: number;
  class_id: number;
  class_label: string | null;
  name: string;
  scientific_name: string | null;
  severity: string | null;
  affected_crop: string | null;
  organic_treatment: string | null;
  organic_dosage: string | null;
  chemical_treatment: string | null;
  chemical_dosage: string | null;
  store_product: string | null;
  kannada_name: string | null;
  kannada_organic: string | null;
  kannada_chemical: string | null;
  prevention: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const IMG_SIZE = 224;
const DB_NAME = 'disease_treatments.db';

// 38 classes — order MUST match backend/ai/train_disease_model.py CLASS_LABELS
// AND class_id 0-37 in disease_treatments.db. Update all three together.
const CLASS_NAMES: string[] = [
  'Apple Scab',                         //  0
  'Apple Black Rot',                    //  1
  'Cedar Apple Rust',                   //  2
  'Healthy Apple',                      //  3
  'Healthy Blueberry',                  //  4
  'Cherry Powdery Mildew',              //  5
  'Healthy Cherry',                     //  6
  'Corn Gray Leaf Spot',                //  7
  'Corn Common Rust',                   //  8
  'Corn Northern Leaf Blight',          //  9
  'Healthy Corn',                       // 10
  'Grape Black Rot',                    // 11
  'Grape Esca (Black Measles)',         // 12
  'Grape Leaf Blight',                  // 13
  'Healthy Grape',                      // 14
  'Citrus Greening',                    // 15
  'Peach Bacterial Spot',               // 16
  'Healthy Peach',                      // 17
  'Pepper Bacterial Spot',              // 18
  'Healthy Pepper',                     // 19
  'Potato Early Blight',                // 20
  'Potato Late Blight',                 // 21
  'Healthy Potato',                     // 22
  'Healthy Raspberry',                  // 23
  'Healthy Soybean',                    // 24
  'Squash Powdery Mildew',              // 25
  'Strawberry Leaf Scorch',             // 26
  'Healthy Strawberry',                 // 27
  'Tomato Bacterial Spot',              // 28
  'Tomato Early Blight',                // 29
  'Tomato Late Blight',                 // 30
  'Tomato Leaf Mold',                   // 31
  'Tomato Septoria Leaf Spot',          // 32
  'Tomato Spider Mites',                // 33
  'Tomato Target Spot',                 // 34
  'Tomato Yellow Leaf Curl Virus',      // 35
  'Tomato Mosaic Virus',                // 36
  'Healthy Tomato',                     // 37
];

// Gate thresholds — tuned via backend/ai/_stress_test.py against the CURRENT
// shipped model (PlantVillage + PlantDoc merged, 93.91% val). The merged
// model produces smoother probability distributions than PlantVillage alone
// (fine-tuning on mixed lab+field data spreads mass across similar-looking
// classes), so gate thresholds must match that distribution — an over-strict
// gate against a smooth-output model just refuses every real leaf.
// A "please retake" alert is still preferred to a confident wrong diagnosis,
// but not at the cost of refusing valid diagnoses the farmer needs.
const LEAF_MIN_RATIO   = 0.15;   // spatial-coherence-adjusted score (see leafGreenRatio)
const CONF_THRESHOLD   = 0.45;   // top prob must be at least 45%
const CONF_MARGIN      = 0.10;   // top must beat second by >= 10 percentage points
const DECISIVE_MARGIN  = 0.25;   // when margin is this large, accept even below CONF_THRESHOLD (down to CONF_FLOOR)
const CONF_FLOOR       = 0.30;   // absolute floor even for decisive-margin cases
const AMBIGUITY_MARGIN = 0.20;   // if top 2 are the SAME CROP, need >= 20% margin
// Only classes where post-PlantDoc stress-test accuracy is still < 50%.
// Tomato Spider Mites got only +2 PlantDoc images so remains genuinely weak
// (30%). Tomato Mosaic still ~50%. Requiring extra confidence here means the
// app refuses low-confidence guesses on the two classes most likely to fool
// the model — instead of misleading the farmer.
const STRICT_CLASSES   = new Set<number>([33, 36]);      // Tomato Spider Mites, Mosaic
const STRICT_CONF      = 0.55;   // strict-class extra bar

// Crop family per class_id — enables the ambiguity guard for same-crop pairs.
// Index MUST match CLASS_NAMES below.
const CLASS_CROPS: string[] = [
  'Apple','Apple','Apple','Apple',              // 0-3
  'Blueberry',                                   // 4
  'Cherry','Cherry',                             // 5-6
  'Corn','Corn','Corn','Corn',                   // 7-10
  'Grape','Grape','Grape','Grape',               // 11-14
  'Orange',                                      // 15
  'Peach','Peach',                               // 16-17
  'Pepper','Pepper',                             // 18-19
  'Potato','Potato','Potato',                    // 20-22
  'Raspberry',                                   // 23
  'Soybean',                                     // 24
  'Squash',                                      // 25
  'Strawberry','Strawberry',                     // 26-27
  'Tomato','Tomato','Tomato','Tomato','Tomato',
  'Tomato','Tomato','Tomato','Tomato','Tomato',  // 28-37
];

// ── Module-level singletons (survive re-mounts, no reload loop) ───────────────
let sharedModel: TensorflowModel | null = null;
let sharedModelPromise: Promise<TensorflowModel | null> | null = null;
let sharedDb: SQLite.SQLiteDatabase | null = null;
let sharedDbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;
// Last failure captured so the UI can display the ACTUAL error message
// on-screen. Without this the "AI model failed to load" card gives the
// farmer (and us during triage) zero information about what went wrong.
let lastLoadError: string | null = null;
export function getLastLoadError(): string | null { return lastLoadError; }

async function loadModelOnce(): Promise<TensorflowModel | null> {
  if (sharedModel) return sharedModel;
  if (sharedModelPromise) return sharedModelPromise;
  sharedModelPromise = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const modelModule = require('../../assets/models/crop_disease_v1.tflite');
      if (typeof loadTensorflowModel !== 'function') {
        throw new Error(
          `loadTensorflowModel is ${typeof loadTensorflowModel} (expected function). ` +
          `react-native-fast-tflite may be stubbed or missing.`
        );
      }
      // ─── ACTUAL FIX for the Sep 2026 production-APK crash ────────────
      // Passing `require(...)` directly (which returns a number in RN) makes
      // react-native-fast-tflite internally call Image.resolveAssetSource,
      // which in PRODUCTION Android builds returns a bare name like
      // `assets_models_crop_disease_v1` with NO url protocol. Its native
      // code then blows up with:
      //   java.net.MalformedURLException: no protocol: assets_models_...
      // In dev this worked because Metro served the asset over http:// which
      // has a protocol.
      //
      // Fix: explicitly materialise the bundled asset to a real file:// URL
      // via expo-asset, then pass `{ url }` to loadTensorflowModel. That
      // path skips the broken resolveAssetSource branch entirely and gives
      // the native loader a URL it can open directly on any Android version.
      const asset = Asset.fromModule(modelModule);
      await asset.downloadAsync();
      if (!asset.localUri) {
        throw new Error('TFLite model asset materialised but localUri is missing');
      }
      // The URL form is officially supported by loadTensorflowModel and
      // takes any 'http://', 'https://', or 'file://' string. asset.localUri
      // is always a file:// URI in an installed APK.
      const model = await (loadTensorflowModel as any)({ url: asset.localUri }, []);
      sharedModel = model;
      lastLoadError = null;
      console.log('[useDiseaseDetection] model loaded once. uri=', asset.localUri,
        '\ninputs=', JSON.stringify((model as any).inputs ?? 'unknown'),
        '\noutputs=', JSON.stringify((model as any).outputs ?? 'unknown'));
      return model;
    } catch (e: any) {
      // FULL error visible in Metro/logcat — was previously just `.message`
      // which threw away the stack trace and root cause.
      const msg = e?.message || String(e);
      lastLoadError = msg;
      console.warn('[useDiseaseDetection] model load FAILED:',
        msg, '\nstack:', e?.stack);
      // Poison-cache guard: reset the promise so the NEXT retry (mount, or
      // user tapping the retry button) actually re-runs the load instead
      // of getting the same rejected promise back. Without this, one
      // transient asset-server hiccup left the AI dead until app kill.
      sharedModelPromise = null;
      return null;
    }
  })();
  return sharedModelPromise;
}

/** Explicit retry — clears the module-level cache and re-runs the load.
 *  Used by the "Retry" button on the AI-failed error screen. */
export async function retryModelLoad(): Promise<boolean> {
  sharedModel = null;
  sharedModelPromise = null;
  const m = await loadModelOnce();
  return !!m;
}

// Version key — bump when the bundled DB schema changes so old on-device copies
// are wiped and the new asset re-copies. Without this the schema mismatch would
// cause every disease lookup to fail silently.
const DB_SCHEMA_VERSION = 3;

async function ensureDBCopied(): Promise<void> {
  const sqliteDir = new Directory(Paths.document, 'SQLite');
  const destFile  = new File(sqliteDir, DB_NAME);
  const versionFile = new File(sqliteDir, `${DB_NAME}.version`);

  if (destFile.exists && versionFile.exists) {
    try {
      const v = parseInt(versionFile.text(), 10);
      if (v === DB_SCHEMA_VERSION) return;
    } catch { /* fall through and re-copy */ }
  }

  if (!sqliteDir.exists) sqliteDir.create({ intermediates: true });
  if (destFile.exists) destFile.delete();
  const asset = Asset.fromModule(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/disease_treatments.db')
  );
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Asset localUri missing');
  await new File(asset.localUri).copy(destFile);
  versionFile.write(String(DB_SCHEMA_VERSION));
}

async function ensureFeedbackTable(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS scan_feedback (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    INTEGER NOT NULL,
      photo_uri     TEXT,
      predicted_id  INTEGER NOT NULL,
      predicted_lbl TEXT NOT NULL,
      confidence    REAL NOT NULL,
      is_correct    INTEGER NOT NULL,
      corrected_id  INTEGER
    );
  `);
}

/**
 * Records a farmer's Correct / Wrong tap after a diagnosis.
 * Stored locally in SQLite for later retraining once we have a sync path.
 */
export async function recordScanFeedback(
  photoUri: string,
  predictedId: number,
  predictedLabel: string,
  confidence: number,
  isCorrect: boolean,
  correctedId: number | null = null,
): Promise<void> {
  if (!sharedDb) await openDbOnce();
  if (!sharedDb) return;
  try {
    await ensureFeedbackTable(sharedDb);
    await sharedDb.runAsync(
      `INSERT INTO scan_feedback
       (created_at, photo_uri, predicted_id, predicted_lbl, confidence, is_correct, corrected_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Date.now(), photoUri, predictedId, predictedLabel, confidence, isCorrect ? 1 : 0, correctedId]
    );
  } catch (e: any) {
    console.log('[useDiseaseDetection] feedback write failed:', e?.message || String(e));
  }
}

async function openDbOnce(): Promise<SQLite.SQLiteDatabase | null> {
  if (sharedDb) return sharedDb;
  if (sharedDbPromise) return sharedDbPromise;
  sharedDbPromise = (async () => {
    try {
      await ensureDBCopied();
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      sharedDb = db;
      return db;
    } catch (e: any) {
      console.log('[useDiseaseDetection] db open failed:', e?.message || String(e));
      return null;
    }
  })();
  return sharedDbPromise;
}

// ── Base64 → Uint8Array (self-contained, no atob/Buffer dependency) ─────────
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;

function base64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/^data:[^,]+,/, '').replace(/[\r\n\s]/g, '');
  const padded = s.replace(/=+$/, '');
  const len = padded.length;
  const outLen = (len * 3) >> 2;
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_LOOKUP[s.charCodeAt(i)] || 0;
    const c1 = B64_LOOKUP[s.charCodeAt(i + 1)] || 0;
    const c2 = B64_LOOKUP[s.charCodeAt(i + 2)] || 0;
    const c3 = B64_LOOKUP[s.charCodeAt(i + 3)] || 0;
    if (p < outLen) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < outLen) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < outLen) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

function decodeJpegBase64(b64: string): { data: Uint8Array; width: number; height: number } {
  const bytes = base64ToBytes(b64);
  const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 128, formatAsRGBA: true });
  return { data: decoded.data as Uint8Array, width: decoded.width, height: decoded.height };
}

/**
 * Two-stage leaf gate — must both pass:
 *   (a) Vegetation ratio via ExG index (2G-R-B > 15) on saturated pixels.
 *       Accepts pale/reddish leaves (peach) that the old strict g>r+6 rule
 *       was falsely rejecting.
 *   (b) Spatial coherence — real leaves have vegetation concentrated in a
 *       contiguous region; random RGB noise passes per-pixel greenness by
 *       chance but is uniformly low-density everywhere. We compute per-cell
 *       density on a 14x14 grid (16x16 patches) and require the standard
 *       deviation across cells to be high enough. Without this, random
 *       phone-camera glitches / noise images can pass through and get a
 *       confident (wrong) disease diagnosis.
 * Returns min(veg_ratio, coherence_score) so a single number still drives
 * the gate — 0 = definitely not a leaf, 1 = solid leaf.
 * Verified against backend/ai/_stress_test.py: this brings synthetic-noise
 * rejection from 91% to 100% while cutting real-leaf false rejections
 * from 6.6% to 3.9% (peach/soybean/citrus/tomato-late all recover).
 */
function leafGreenRatio(rgba: Uint8Array, w: number, h: number): number {
  // Per-pixel vegetation mask, plus 14x14 grid densities in a single pass.
  const GRID = 14;
  const CELL = Math.floor(w / GRID);     // 16 for 224x224
  const cellCounts = new Uint16Array(GRID * GRID);
  let vegTotal = 0;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID - 1, (y / CELL) | 0);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = rgba[idx], g = rgba[idx + 1], b = rgba[idx + 2];
      const maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (maxC < 40) continue;
      if (maxC - minC < 15) continue;
      const exg = 2 * g - r - b;         // ExG vegetation index
      if (exg <= 15) continue;
      vegTotal++;
      const gx = Math.min(GRID - 1, (x / CELL) | 0);
      cellCounts[gy * GRID + gx]++;
    }
  }
  const totalPx = w * h;
  const vegRatio = vegTotal / totalPx;

  // Spatial coherence: stdev of per-cell density across the 14x14 grid.
  const cellArea = CELL * CELL;
  let mean = 0;
  for (let i = 0; i < cellCounts.length; i++) mean += cellCounts[i] / cellArea;
  mean /= cellCounts.length;
  let variance = 0;
  for (let i = 0; i < cellCounts.length; i++) {
    const d = cellCounts[i] / cellArea - mean;
    variance += d * d;
  }
  variance /= cellCounts.length;
  const coherence = Math.sqrt(variance);
  const coherenceScore = Math.min(1, coherence / 0.35);

  return Math.min(vegRatio, coherenceScore);
}

function rgbaToRgbUint8(rgba: Uint8Array, expectedPixels: number): Uint8Array {
  const out = new Uint8Array(expectedPixels * 3);
  let j = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    out[j++] = rgba[i];
    out[j++] = rgba[i + 1];
    out[j++] = rgba[i + 2];
  }
  return out;
}

function softmax(x: number[]): number[] {
  const max = Math.max(...x);
  const exps = x.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDiseaseDetection() {
  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(!!sharedModel && !!sharedDb);
  const [isRunning, setIsRunning]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  // runtimeBroken ONLY reflects a genuine one-time load failure — never
  // permanently latched from per-image inference errors (those are transient).
  const [runtimeBroken, setRuntimeBroken] = useState<boolean>(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let done = false;
    (async () => {
      // Fire both loads in parallel but DON'T gate the ready-flag on the
      // DB. Farmers were seeing "Loading AI…" forever when the treatments
      // DB copy silently failed on some Expo FileSystem v2 builds — the
      // model was ready but the combined-gate held the UI hostage.
      // The DB is only needed AFTER a scan for the treatment lookup;
      // by then lazy openDbOnce() calls (see lookupRow / recordScanFeedback)
      // retry it, so the split is safe.
      const modelPromise = loadModelOnce();
      openDbOnce().catch(() => null);   // fire-and-forget; retried lazily

      const m = await modelPromise;
      if (done || !mountedRef.current) return;
      if (m) {
        setIsModelLoaded(true);
        setRuntimeBroken(false);
      } else {
        setRuntimeBroken(true);
      }
    })();
    return () => { done = true; mountedRef.current = false; };
  }, []);

  const lookupRow = useCallback(async (classIdx: number): Promise<DiseaseRow | null> => {
    if (!sharedDb) return null;
    let row = await sharedDb.getFirstAsync<DiseaseRow>(
      'SELECT * FROM diseases WHERE class_id = ?',
      [classIdx]
    );
    if (!row) {
      const label = CLASS_NAMES[classIdx] ?? '';
      row = await sharedDb.getFirstAsync<DiseaseRow>(
        'SELECT * FROM diseases WHERE LOWER(name) = LOWER(?) LIMIT 1',
        [label]
      );
    }
    return row;
  }, []);

  const runInference = useCallback(
    async (photoUri: string): Promise<InferenceResult> => {
      const empty = (status: InferenceStatus, reason: string, hint: string): InferenceResult => ({
        status, reason, hint,
        classIndex: -1, classLabel: '', confidence: 0,
        disease_name: '', scientific_name: null, severity: '',
        affected_crop: '',
        organic_treatment: null, organic_dosage: null,
        chemical_treatment: null, chemical_dosage: null,
        store_product: null,
        kannada_name: null, kannada_organic: null, kannada_chemical: null,
        prevention: null,
        leafScore: 0, topProbs: [],
      });

      // Lazy-await load so first inference call self-heals if hook mount races.
      if (!sharedModel) await loadModelOnce();
      if (!sharedDb)    await openDbOnce();

      if (!sharedModel) {
        setRuntimeBroken(true);
        return empty(
          'error',
          'On-device AI could not initialise.',
          'Restart the app or use the Disease Library to look up symptoms.'
        );
      }
      if (!sharedDb) {
        return empty('error', 'Treatment database not ready.', 'Please wait a moment and retry.');
      }

      setIsRunning(true);
      try {
        // 1. Two-stage resize to avoid OOM on huge gallery photos
        let resized: ImageManipulator.ImageResult;
        try {
          const preShrink = await ImageManipulator.manipulateAsync(
            photoUri,
            [{ resize: { width: 512 } }],
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
          );
          resized = await ImageManipulator.manipulateAsync(
            preShrink.uri,
            [{ resize: { width: IMG_SIZE, height: IMG_SIZE } }],
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.92, base64: true }
          );
        } catch (e: any) {
          console.log('[useDiseaseDetection] resize failed:', e?.message || String(e));
          return empty('error', 'Could not read the photo.', 'Please pick a smaller image or retake the photo.');
        }
        if (!resized.base64) {
          return empty('error', 'Could not read the photo.', 'Please retake the picture.');
        }

        // 2. Decode
        let pixels: { data: Uint8Array; width: number; height: number };
        try {
          pixels = decodeJpegBase64(resized.base64);
        } catch (e) {
          return empty('error', 'Could not decode the image.', 'Please try a different photo.');
        }
        if (pixels.width !== IMG_SIZE || pixels.height !== IMG_SIZE) {
          return empty('error', `Unexpected image size ${pixels.width}×${pixels.height}.`, 'Please retake the photo.');
        }

        // 3. Leaf gate
        const leafScore = leafGreenRatio(pixels.data, pixels.width, pixels.height);
        if (leafScore < LEAF_MIN_RATIO) {
          return {
            ...empty(
              'not_a_leaf',
              "This doesn't look like a plant leaf.",
              'Fill the frame with a single clear crop leaf in good light and try again.'
            ),
            leafScore,
          };
        }

        // 4. Build input tensor (uint8 matches model dtype; pass .buffer as required)
        const uint8Input = rgbaToRgbUint8(pixels.data, IMG_SIZE * IMG_SIZE);

        // 5. Run model
        let outputs: any;
        try {
          const modelAny: any = sharedModel;
          if (typeof modelAny.runSync === 'function') {
            outputs = modelAny.runSync([uint8Input.buffer]);
          } else {
            outputs = await modelAny.run([uint8Input.buffer]);
          }
        } catch (e: any) {
          console.log('[useDiseaseDetection] inference throw:', e?.message || String(e));
          // Per-image error — do NOT permanently mark runtime broken; it may just be
          // one bad photo. Return honest error for this image.
          return empty('error', 'AI could not read this image.', 'Please retake the photo or try another one.');
        }

        // 6. Normalise output — Uint8Array, ArrayBuffer, or wrapped
        let rawTensor: any =
          outputs && outputs[0] !== undefined ? outputs[0] : outputs;
        if (rawTensor instanceof ArrayBuffer) {
          rawTensor = new Uint8Array(rawTensor);
        }
        if (!rawTensor || (rawTensor.length ?? rawTensor.byteLength ?? 0) < 1) {
          return empty('error', 'Model returned no output.', 'Please retake the photo.');
        }

        // 7. Dequantise → probabilities
        const arr: number[] = Array.from(rawTensor as any).slice(0, CLASS_NAMES.length);
        const rawMax = Math.max(...arr);
        let probs: number[];
        if (rawMax > 1.01) {
          const dequant = arr.map(v => v / 255);
          const sum = dequant.reduce((a, b) => a + b, 0);
          probs = (sum > 0.9 && sum < 1.1)
            ? dequant                              // already a distribution
            : (sum > 0.01 ? dequant.map(v => v / sum) : softmax(dequant));
        } else {
          probs = arr;
        }
        console.log('[useDiseaseDetection] probs:', probs.map(p => p.toFixed(2)).join(', '));

        // 8. Argmax + confidence gate
        const ranked = probs
          .map((p, i) => ({ i, p, label: CLASS_NAMES[i] ?? `class_${i}` }))
          .sort((a, b) => b.p - a.p);
        const topProbs = ranked.slice(0, 3).map(r => ({ label: r.label, prob: r.p }));
        const top = ranked[0];
        const second = ranked[1] ?? { p: 0, i: -1, label: '' };
        const margin = top.p - second.p;

        // Farmer-safe confidence gate — three checks, any failure -> refuse honestly.
        const topCrop = CLASS_CROPS[top.i] ?? '';
        const secondCrop = second.i >= 0 ? (CLASS_CROPS[second.i] ?? '') : '';
        const sameCropAmbiguous = topCrop && topCrop === secondCrop && margin < AMBIGUITY_MARGIN;
        const needsStrict = STRICT_CLASSES.has(top.i);
        const strictFail = needsStrict && top.p < STRICT_CONF;

        // Decisive-margin override: if the top guess is FAR ahead of the second
        // (>= 25pp margin) and above an absolute floor of 30%, treat as OK even
        // if it doesn't clear the normal 45% threshold. This handles cases like
        // "Potato Early 44% vs Tomato Early 16%" where a 28pp gap is a much
        // stronger signal than a 1pp shortfall on absolute confidence.
        const decisive = margin >= DECISIVE_MARGIN && top.p >= CONF_FLOOR;
        const confFail   = !decisive && top.p < CONF_THRESHOLD;
        const marginFail = margin < CONF_MARGIN;   // margin<10pp always fails

        if (confFail || marginFail || sameCropAmbiguous || strictFail) {
          const failedGate =
            sameCropAmbiguous ? 'AMBIGUITY(same-crop-top-2)' :
            strictFail        ? `STRICT_CLASS(${top.label} needs >=${(STRICT_CONF*100)|0}%)` :
            marginFail        ? `LOW_MARGIN(${(margin*100).toFixed(0)}pp < ${(CONF_MARGIN*100)|0}pp)` :
                                `LOW_CONF(${(top.p*100).toFixed(0)}% < ${(CONF_THRESHOLD*100)|0}%, margin ${(margin*100).toFixed(0)}pp)`;
          console.log(`[useDiseaseDetection] REFUSED: ${failedGate} · top=${top.label} @ ${(top.p*100).toFixed(0)}% · 2nd=${second.label} @ ${(second.p*100).toFixed(0)}%`);
          const reason = sameCropAmbiguous
            ? `Cannot tell ${top.label} from ${second.label} on this photo.`
            : strictFail
            ? `Not confident enough for ${top.label} (${(top.p * 100).toFixed(0)}%).`
            : `Not confident enough (top guess ${(top.p * 100).toFixed(0)}%).`;
          return {
            ...empty(
              'low_confidence',
              reason,
              'Retake a close-up of ONE affected leaf in good daylight, filling the frame.'
            ),
            leafScore,
            classIndex: top.i,
            classLabel: top.label,
            confidence: Math.round(top.p * 100),
            topProbs,
          };
        }

        // 9. Lookup
        const row = await lookupRow(top.i);
        const crop = row?.affected_crop ?? (row?.name ?? top.label).split(' ')[0];

        return {
          status: 'ok',
          classIndex: top.i,
          classLabel: top.label,
          confidence: Math.round(top.p * 100),
          disease_name: row?.name ?? top.label,
          scientific_name: row?.scientific_name ?? null,
          severity: row?.severity ?? (top.label.startsWith('Healthy') ? 'Low' : 'Medium'),
          affected_crop: crop,
          organic_treatment: row?.organic_treatment ?? null,
          organic_dosage: row?.organic_dosage ?? null,
          chemical_treatment: row?.chemical_treatment ?? null,
          chemical_dosage: row?.chemical_dosage ?? null,
          store_product: row?.store_product ?? null,
          kannada_name: row?.kannada_name ?? null,
          kannada_organic: row?.kannada_organic ?? null,
          kannada_chemical: row?.kannada_chemical ?? null,
          prevention: row?.prevention ?? null,
          leafScore,
          topProbs,
        };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        console.log('[useDiseaseDetection] inference error:', msg);
        setError(msg);
        return empty('error', 'Something went wrong analysing this photo.', 'Please try again.');
      } finally {
        setIsRunning(false);
      }
    },
    [lookupRow]
  );

  const retryLoad = useCallback(async () => {
    setRuntimeBroken(false);
    setIsModelLoaded(false);
    const ok = await retryModelLoad();
    if (!mountedRef.current) return;
    setIsModelLoaded(ok);
    setRuntimeBroken(!ok);
  }, []);

  return { isModelLoaded, isRunning, error, runInference, runtimeBroken, retryLoad };
}
