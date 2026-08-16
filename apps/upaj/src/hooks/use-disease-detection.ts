import { useEffect, useRef, useState, useCallback } from 'react';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import * as SQLite from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';
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

// ── Helper: copy bundled DB asset to SQLite directory ─────────────────────────

async function ensureDBCopied(): Promise<void> {
  const sqliteDir = new Directory(Paths.document, 'SQLite');
  const destFile = new File(sqliteDir, DB_NAME);

  if (destFile.exists) return;

  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true });
  }

  const asset = Asset.fromModule(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/disease_treatments.db')
  );
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error('[useDiseaseDetection] Failed to resolve DB asset localUri');
  }

  const srcFile = new File(asset.localUri);
  await srcFile.copy(destFile);
}

// ── Helper: preprocess photo → Float32Array [0, 1] (H×W×C) ──────────────────

async function photoToFloat32(uri: string): Promise<Float32Array> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: IMG_SIZE, height: IMG_SIZE } }],
    { base64: true, format: ImageManipulator.SaveFormat.JPEG }
  );

  const base64 = result.base64;
  if (!base64) throw new Error('[useDiseaseDetection] manipulateAsync returned no base64');

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

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const model = await loadTensorflowModel(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../assets/models/crop_disease_v1.tflite'),
          []
        );
        if (cancelled) return;
        modelRef.current = model;

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
      dbRef.current?.closeAsync().catch(() => {});
      dbRef.current = null;
    };
  }, []);

  const runInference = useCallback(
    async (photoUri: string): Promise<InferenceResult | null> => {
      if (!modelRef.current || !dbRef.current) {
        console.warn('[useDiseaseDetection] Model or DB not ready');
        return null;
      }

      setIsRunning(true);
      try {
        const inputTensor = await photoToFloat32(photoUri);
        // run() accepts and returns ArrayBuffer[]
        const outputs = await modelRef.current.run([inputTensor.buffer as ArrayBuffer]);
        const outputBuf = outputs[0];

        // Try Float32 first, fall back to Uint8 if values look quantized
        const float32View = new Float32Array(outputBuf);
        const uint8View   = new Uint8Array(outputBuf);
        const isInt8Output = float32View.every(v => Number.isInteger(v) && v >= 0 && v <= 255);

        let scores: number[];
        if (isInt8Output) {
          const sum = uint8View.reduce((a, b) => a + b, 0) || 1;
          scores = Array.from(uint8View).map((v) => v / sum);
        } else {
          scores = Array.from(float32View);
        }

        const sliced = scores.slice(0, NUM_CLASSES);
        const { index: classIdx, value: rawConf } = argmax(sliced);
        const confidence = Math.round(rawConf * 100);
        const classLabel = CLASS_NAMES[classIdx] ?? `class_${classIdx}`;

        const row = await dbRef.current.getFirstAsync<DiseaseRow>(
          'SELECT * FROM diseases WHERE class_index = ?',
          [classIdx]
        );

        if (!row) {
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
