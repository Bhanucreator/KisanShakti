/**
 * Soil-moisture push-notification watcher.
 *
 * Subscribes to the sensor bus and fires an OS tray notification (via
 * expo-notifications) when the ESP32 soil probe reports moisture below a
 * dry threshold. Only fires ONCE per dry episode — hysteresis-guarded so
 * a probe hovering at the threshold doesn't spam the farmer.
 *
 * Wired once from the root layout (see src/app/_layout.tsx). No React —
 * this is a pure module-level side effect that runs whenever the app is
 * alive (foregrounded or backgrounded in memory).
 *
 * Uses only the sensor-source snapshot; a weather-API fallback frame is
 * ignored because it doesn't reflect the farmer's actual field.
 */
import { subscribeSensor, type SensorSnapshot } from './sensor-bus';

// Farmer-friendly thresholds. Kept as a two-band hysteresis so a probe
// jittering at exactly 30% doesn't trigger repeatedly.
const DRY_THRESHOLD_PCT       = 30;   // fire when we cross BELOW this
const RECOVERED_THRESHOLD_PCT = 40;   // re-arm only after moisture climbs above this
// Minimum wait between two alerts even if the farmer manages to trigger
// two dry episodes in quick succession. Guards against a flaky sensor.
const MIN_ALERT_INTERVAL_MS   = 30 * 60 * 1000;  // 30 minutes

let _watcherStarted   = false;
let _alertArmed       = true;       // false while a dry alert is standing
let _lastAlertAt      = 0;

// Lazy require so the app still boots when expo-notifications is missing
// (e.g. Expo Go on SDK 53+).
let _Notifs: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _Notifs = require('expo-notifications');
} catch { _Notifs = null; }

async function fireDryAlert(pct: number) {
  if (!_Notifs) return;
  try {
    const cur = await _Notifs.getPermissionsAsync();
    if (cur.status !== 'granted') {
      const r = await _Notifs.requestPermissionsAsync();
      if (r.status !== 'granted') return;
    }
    await _Notifs.scheduleNotificationAsync({
      content: {
        title: 'Soil is drying out · ಮಣ್ಣಿನ ತೇವಾಂಶ ಕಡಿಮೆ',
        body:  (
          `Field moisture just dropped to ${Math.round(pct)}%. ` +
          `Check irrigation before the crop stresses. ` +
          `ಮಣ್ಣಿನ ತೇವಾಂಶ ${Math.round(pct)}%ಗೆ ಇಳಿದಿದೆ. ` +
          `ಬೆಳೆಗೆ ಒತ್ತಡವಾಗುವ ಮೊದಲು ನೀರುಣಿಸಿ.`
        ),
        data:  { deep_link: '/(tabs)/weather' },
        sound: true,
      },
      trigger: null,
    });
    console.log('[soil-alert] fired dry alert @', pct, '%');
  } catch (e) {
    console.warn('[soil-alert] fire failed:', (e as any)?.message);
  }
}

function onSensor(snap: SensorSnapshot | null) {
  if (!snap || snap.source !== 'sensor') return;
  const pct = snap.soil_moisture;
  if (!Number.isFinite(pct)) return;

  if (_alertArmed && pct < DRY_THRESHOLD_PCT) {
    if (Date.now() - _lastAlertAt < MIN_ALERT_INTERVAL_MS) return;
    _alertArmed  = false;
    _lastAlertAt = Date.now();
    fireDryAlert(pct);
  } else if (!_alertArmed && pct >= RECOVERED_THRESHOLD_PCT) {
    // Soil recovered — re-arm so the next dry-out fires again.
    _alertArmed = true;
    console.log('[soil-alert] re-armed @', pct, '%');
  }
}

/** Idempotent — safe to call from any component's useEffect. */
export function startSoilMoistureWatcher() {
  if (_watcherStarted) return;
  _watcherStarted = true;
  subscribeSensor(onSensor);
  console.log('[soil-alert] watcher started (dry <',
              DRY_THRESHOLD_PCT, '%, recovered >=', RECOVERED_THRESHOLD_PCT, '%)');
}
