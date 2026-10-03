/**
 * Cross-screen sensor bus.
 *
 * The Weather tab owns the BLE connection to the ESP32 field node and
 * publishes each fresh sensor frame into this module-level singleton.
 * Other screens (Home's AI Recommendations, future dashboards) subscribe
 * to read the *latest* value without needing their own BLE stack.
 *
 * Kept intentionally small — no React context, no persistence, no async
 * layer — because this is a fast-moving in-memory snapshot, not app state
 * that needs to survive an app kill.
 */

export interface SensorSnapshot {
  soil_moisture: number;   // 0-100 %  (NaN when unknown, e.g. weather-API fallback mode)
  temperature:   number;   // °C
  humidity:      number;   // 0-100 %
  is_raining:    boolean;
  at:            number;   // Date.now() when we received the frame
  // 'sensor'      — live BLE stream from a nearby ESP32
  // 'wifi-remote' — ESP32 posting to the backend from somewhere else
  // 'weather-api' — no ESP32; showing regional weather-API values instead
  source:        'sensor' | 'wifi-remote' | 'weather-api';
}

type Listener = (snap: SensorSnapshot | null) => void;

let current: SensorSnapshot | null = null;
const listeners = new Set<Listener>();

export function publishSensor(snap: Omit<SensorSnapshot, 'at'>) {
  current = { ...snap, at: Date.now() };
  listeners.forEach(l => { try { l(current); } catch (_) {} });
}

export function clearSensor() {
  current = null;
  listeners.forEach(l => { try { l(null); } catch (_) {} });
}

export function getLatestSensor(): SensorSnapshot | null {
  return current;
}

export function subscribeSensor(l: Listener): () => void {
  listeners.add(l);
  // Fire immediately with whatever we already have so the caller doesn't
  // have to wait for the next BLE frame to render its first value.
  try { l(current); } catch (_) {}
  return () => { listeners.delete(l); };
}
