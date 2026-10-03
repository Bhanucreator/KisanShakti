/**
 * TFLite stub for Expo Go compatibility.
 *
 * react-native-fast-tflite requires react-native-nitro-modules which is a
 * native module and cannot run in Expo Go. This file provides an identical
 * API surface that returns mock inference results so the app can be demoed
 * in Expo Go without a full dev build.
 *
 * In a production development build (eas build / expo run:android), the real
 * module is used — just remove the metro alias below.
 */

export type TensorflowModel = {
  run: (inputs: { [key: string]: Float32Array | Uint8Array }) => {
    [key: string]: Float32Array;
  };
};

export type TensorflowModelState =
  | { state: 'loading' }
  | { state: 'error'; error: Error }
  | { state: 'loaded'; model: TensorflowModel };

// Mock model that returns a randomised disease class score array
const createMockModel = (): TensorflowModel => ({
  run: () => {
    // Simulate 38-class output (PlantVillage dataset classes)
    const scores = new Float32Array(38).fill(0.01);
    const topClass = Math.floor(Math.random() * 38);
    scores[topClass] = 0.85 + Math.random() * 0.12;
    return { output: scores };
  },
});

export function useTensorflowModel(
  _source: { assetId: number } | { url: string } | { filePath: string },
): TensorflowModelState {
  // Return immediately as "loaded" with a mock model in Expo Go
  return { state: 'loaded', model: createMockModel() };
}

/**
 * Imperative model-loader — the shape actually used by
 * `useDiseaseDetection`. The mock returns a model whose runSync/run methods
 * emit a randomised 38-class Uint8Array, so the whole inference pipeline
 * runs end-to-end in Metro dev with realistic-shaped outputs. Prevents the
 * "Loading AI…" screen hanging forever when developers work in Expo Go.
 */
export async function loadTensorflowModel(
  _source: unknown,
  _options?: unknown,
): Promise<TensorflowModel & {
  runSync: (inputs: any[]) => any[];
  inputs?: any[]; outputs?: any[];
}> {
  const scores = new Uint8Array(38).fill(2);
  const topClass = Math.floor(Math.random() * 38);
  scores[topClass] = 200 + Math.floor(Math.random() * 40);
  return {
    // real API — runSync (used by useDiseaseDetection) + run (mock legacy)
    runSync: (_inputs: any[]) => [scores],
    run: () => ({ output: scores }),
    // Shape metadata so console.log inputs=/outputs= doesn't say "unknown"
    inputs:  [{ name: 'mock_in',  dataType: 'uint8', shape: [1, 224, 224, 3] }],
    outputs: [{ name: 'mock_out', dataType: 'uint8', shape: [1, 38] }],
  } as any;
}
