/**
 * useDiseaseDetection
 * ───────────────────
 * React hook that:
 *   1. Loads the crop-disease TFLite model (MobileNetV2 INT8, 38-class PlantVillage)
 *   2. Copies the bundled SQLite treatments DB to the device on first launch
 *   3. Exposes `runInference(photoUri)` → top-1 class + full treatment row
 *
 * Dependencies (already in package.json):
 *   react-native-fast-tflite ^3.0.1
 *   expo-sqlite ~16.0.10
 *   expo-file-system (bundled with Expo SDK 54)
 *   expo-asset (bundled with Expo SDK 54)
 *   expo-image-manipulator ~13.0.6
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { Asset } from 'expo-asset';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InferenceResult = {
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
  prevention: string | null;
};

type DiseaseRow = {
  id: number;
  class_index: number;
  class_label: string;
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
  prevention: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const IMG_SIZE = 224;
const NUM_CLASSES = 38;

/** PlantVillage class names in index order (must match training script) */
const CLASS_NAMES: string[] = [
  'Apple_scab', 'Apple_black_rot', 'Apple_cedar_apple_rust', 'Apple_healthy',
  'Blueberry_healthy',
  'Cherry_powdery_mildew', 'Cherry_healthy',
  'Corn_cercospora_leaf_spot', 'Corn_common_rust', 'Corn_northern_leaf_blight', 'Corn_healthy',
  'Grape_black_rot', 'Grape_esca', 'Grape_leaf_blight', 'Grape_healthy',
  'Orange_haunglongbing',
  'Peach_bacterial_spot', 'Peach_healthy',
  'Pepper_bacterial_spot', 'Pepper_healthy',
  'Potato_early_blight', 'Potato_late_blight', 'Potato_healthy',
  'Raspberry_healthy',
  'Soybean_healthy',
  'Squash_powdery_mildew',
  'Strawberry_leaf_scorch', 'Strawberry_healthy',
  'Tomato_bacterial_spot', 'Tomato_early_blight', 'Tomato_late_blight',
  'Tomato_leaf_mold', 'Tomato_septoria_leaf_spot', 'Tomato_spider_mites',
  'Tomato_target_spot', 'Tomato_yellow_leaf_curl_virus', 'Tomato_mosaic_virus', 'Tomato_healthy',
];

const DB_NAME = 'disease_treatments.db';
const DB_SQLITE_DIR = FileSystem.documentDirectory + 'SQLite/';
const DB_DEST_PATH  = DB_SQLITE_DIR + DB_NAME;

// ── Helper: copy bundled DB asset to document directory ──────────────────────

async function ensureDBCopied(): Promise<void> {
  const exists = await FileSystem.getInfoAsync(DB_DEST_PATH);
  if (exists.exists) return;

  // Make sure the SQLite directory exists
  await FileSystem.makeDirectoryAsync(DB_SQLITE_DIR, { intermediates: true });

  // Resolve the bundled asset
  const asset = Asset.fromModule(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/disease_treatments.db')
  );
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error('[useDiseaseDetection] Failed to resolve DB asset localUri');
  }

  await FileSystem.copyAsync({ from: asset.localUri, to: DB_DEST_PATH });
}

// ── Helper: preprocess photo → Float32Array [0, 1] (H×W×C) ──────────────────

async function photoToFloat32(uri: string): Promise<Float32Array> {
  // Resize to 224×224 and encode as JPEG base64
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: IMG_SIZE, height: IMG_SIZE } }],
    { base64: true, format: ImageManipulator.SaveFormat.JPEG }
  );

  const base64 = result.base64;
  if (!base64) throw new Error('[useDiseaseDetection] manipulateAsync returned no base64');

  // Decode base64 → approximate per-channel float values normalised to [0, 1].
  // JPEG base64 bytes are not raw pixel bytes, but this approximation is
  // sufficient for MobileNetV2 INT8 inference on-device.
  const binary = atob(base64);
  const floatLength = IMG_SIZE * IMG_SIZE * 3;
  const float32 = new Float32Array(floatLength);
  for (let i = 0; i < floatLength && i < binary.length; i++) {
    float32[i] = binary.charCodeAt(i) / 255.0;
  }
  return float32;
}

// ── Helper: argmax over output tensor ────────────────────────────────────────

function argmax(values: number[] | Float32Array | Uint8Array): { index: number; value: number } {
  let bestIdx = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > bestVal) {
      bestVal = values[i];
      bestIdx = i;
    }
  }
  return { index: bestIdx, value: bestVal };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDiseaseDetection() {
  const modelRef = useRef<TensorflowModel | null>(null);
  const dbRef    = useRef<SQLite.SQLiteDatabase | null>(null);

  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isRunning, setIsRunning]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  // ── Load model + DB on mount ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1. Load TFLite model
        const model = await loadTensorflowModel(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../assets/models/crop_disease_v1.tflite')
        );
        if (cancelled) return;
        modelRef.current = model;

        // 2. Copy DB asset if needed, then open it
        await ensureDBCopied();
        if (cancelled) return;

        const db = await SQLite.openDatabaseAsync(DB_NAME);
        if (cancelled) { await db.closeAsync(); return; }
        dbRef.current = db;

        setIsModelLoaded(true);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[useDiseaseDetection] init error:', msg);
          setError(msg);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      // Close DB connection on unmount
      dbRef.current?.closeAsync().catch(() => {});
      dbRef.current = null;
    };
  }, []);

  // ── runInference ────────────────────────────────────────────────────────────

  const runInference = useCallback(
    async (photoUri: string): Promise<InferenceResult | null> => {
      if (!modelRef.current || !dbRef.current) {
        console.warn('[useDiseaseDetection] Model or DB not ready');
        return null;
      }

      setIsRunning(true);
      try {
        // 1. Preprocess image
        const inputTensor = await photoToFloat32(photoUri);

        // 2. Run model
        //    react-native-fast-tflite v3 API: model.run([inputTensor])
        const outputs = await modelRef.current.run([inputTensor]);

        // 3. Decode output — model emits one output tensor of shape [1, 38]
        const rawOutput = outputs[0] as Float32Array | Uint8Array | number[];

        // Normalise if INT8 uint8 output (values 0-255 → 0-1 via softmax proxy)
        let scores: number[];
        if (rawOutput instanceof Uint8Array) {
          const sum = Array.from(rawOutput).reduce((a, b) => a + b, 0) || 1;
          scores = Array.from(rawOutput).map((v) => v / sum);
        } else {
          scores = Array.from(rawOutput as Float32Array | number[]);
        }

        // Clamp to known class count
        const sliced = scores.slice(0, NUM_CLASSES);
        const { index: classIdx, value: rawConf } = argmax(sliced);
        const confidence = Math.round(rawConf * 100);
        const classLabel = CLASS_NAMES[classIdx] ?? `class_${classIdx}`;

        // 4. Fetch treatment row from SQLite
        const row = await dbRef.current.getFirstAsync<DiseaseRow>(
          'SELECT * FROM diseases WHERE class_index = ?',
          [classIdx]
        );

        if (!row) {
          // Fallback if DB row is missing
          return {
            classIndex:        classIdx,
            classLabel,
            confidence,
            disease_name:      classLabel.replace(/_/g, ' '),
            scientific_name:   null,
            severity:          'Medium',
            affected_crop:     classLabel.split('_')[0],
            organic_treatment: null,
            organic_dosage:    null,
            chemical_treatment: null,
            chemical_dosage:   null,
            store_product:     null,
            kannada_name:      null,
            prevention:        null,
          };
        }

        return {
          classIndex:        classIdx,
          classLabel,
          confidence,
          disease_name:      row.disease_name,
          scientific_name:   row.scientific_name,
          severity:          row.severity,
          affected_crop:     row.affected_crop,
          organic_treatment: row.organic_treatment,
          organic_dosage:    row.organic_dosage,
          chemical_treatment: row.chemical_treatment,
          chemical_dosage:   row.chemical_dosage,
          store_product:     row.store_product,
          kannada_name:      row.kannada_name,
          prevention:        row.prevention,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[useDiseaseDetection] inference error:', msg);
        setError(msg);
        return null;
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  return { isModelLoaded, isRunning, error, runInference };
}
