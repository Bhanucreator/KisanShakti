import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Dimensions, Animated, Easing, Platform, PermissionsAndroid,
  Linking, Alert, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import * as Location from 'expo-location';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import {
  fetchForecast, fetchAgriAdvisory, fetchWeather,
  fetchSensorLatest, fetchSensorDevices, updateSensorDevice,
  buildSensorConfigJson, ageLabel, API_BASE,
  type ForecastDay, type AgriAdvisory, type WeatherKind,
} from '../../lib/api';
import { publishSensor, clearSensor } from '../../lib/sensor-bus';
import { useAuth } from '../../hooks/use-auth';

const { width } = Dimensions.get('window');
const t = (en: string, kn: string) => `${en}\n${kn}`;

// ── BLE Constants ────────────────────────────────────────────────────────────
// MUST match hardware/esp32_sensor_node/esp32_sensor_node.ino
const DEVICE_NAME       = 'KisanShakti-ESP32';
const SERVICE_UUID      = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const TX_CHAR_UUID      = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SCAN_TIMEOUT_MS   = 20000;

// Refresh cadence for the cloud advisory (irrigation + fungal + spray)
const ADVISORY_REFRESH_MS = 5 * 60_000;
const FORECAST_REFRESH_MS = 10 * 60_000;   // matches backend cache TTL
// How often we poll the backend for the latest WiFi-pushed reading.
// The ESP32 posts every ~5 min; polling 60s keeps latency low without hammering.
const CLOUD_SENSOR_POLL_MS = 60_000;
// A cloud reading older than this counts as "stale" — banner turns amber.
const CLOUD_STALE_THRESHOLD_S = 15 * 60;
// Debounce: how many consecutive frames must agree before we flip the
// "raining now" banner. At ~5 s per frame → ~15 s of stable reading.
const RAIN_DEBOUNCE_FRAMES = 3;

const bleManager = new BleManager();

// ── Types ────────────────────────────────────────────────────────────────────
// 'bt-off' = phone Bluetooth toggle is OFF (needs user action / native prompt)
type BleStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error' | 'unavailable' | 'bt-off';

interface SensorData {
  soil_moisture: number;
  temperature:   number;
  humidity:      number;
  is_raining:    boolean;
  battery_pct?:  number | null;   // present only for wifi-remote / BLE payloads that include it
}
// Battery UI thresholds: <15 % → red banner, <30 % → amber pill.
const BATT_CRITICAL_PCT = 15;
const BATT_WARN_PCT     = 30;

// 'sensor'       — live 5s BLE stream from a nearby ESP32
// 'wifi-remote'  — ESP32 is elsewhere and pushing to backend every ~5 min
// 'weather-api'  — no ESP32 in play; showing regional weather-API data instead
// 'none'         — nothing yet (still loading GPS/data)
type DataSource = 'sensor' | 'wifi-remote' | 'weather-api' | 'none';

// ── Turn-on-Bluetooth helper ─────────────────────────────────────────────────
// react-native-ble-plx's bleManager.enable() hangs silently on some Android
// builds — the Promise never resolves or rejects. We bypass it and fire the
// standard Android intent that shows the "An app wants to turn on Bluetooth"
// system dialog. Returns true only after the radio actually reports PoweredOn.
async function promptEnableBluetooth(): Promise<boolean> {
  // Try react-native-ble-plx's enable() first, race it with a short timeout
  // so we don't wait forever if it hangs.
  try {
    const enablePromise: Promise<'ok' | 'timeout'> =
      bleManager.enable().then(() => 'ok' as const);
    const timeoutPromise: Promise<'ok' | 'timeout'> =
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1500));
    const raced = await Promise.race([enablePromise, timeoutPromise]);
    if (raced === 'ok') {
      console.log('[BLE] bleManager.enable() succeeded');
      return true;
    }
    console.log('[BLE] bleManager.enable() timed out — falling back to intent');
  } catch (e: any) {
    console.warn('[BLE] bleManager.enable() threw:', e?.message || e);
  }

  // Fallback #1 — direct Android system intent for "Request BT enable".
  // This shows the native OS dialog on any Android version.
  try {
    await Linking.sendIntent('android.bluetooth.adapter.action.REQUEST_ENABLE');
    console.log('[BLE] REQUEST_ENABLE intent sent');
    return true;
  } catch (e: any) {
    console.warn('[BLE] REQUEST_ENABLE intent failed:', e?.message || e);
  }

  // Fallback #2 — open the Bluetooth settings page so the farmer can toggle
  // it themselves. Least automatic but always works.
  Alert.alert(
    'Turn on Bluetooth',
    'Please turn on Bluetooth to connect to your ESP32 sensor.\n\nಬ್ಲೂಟೂತ್ ಆನ್ ಮಾಡಿ · ESP32 ಸಂವೇದಕ ಸಂಪರ್ಕಿಸಲು.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Bluetooth Settings',
        onPress: () => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS')
                              .catch(() => Linking.openSettings()) },
    ],
  );
  return false;
}

// Wait for the BLE radio to actually reach PoweredOn (or timeout).
function waitForBluetoothOn(timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sub.remove();
      resolve(ok);
    };
    const sub = bleManager.onStateChange((state) => {
      console.log('[BLE] state change during wait:', state);
      if (state === 'PoweredOn') finish(true);
    }, true);   // true = fire once immediately with the current state
    setTimeout(() => finish(false), timeoutMs);
  });
}

// ── Permissions ──────────────────────────────────────────────────────────────
async function requestBLEPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const grants = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  // Log each grant so we can see WHICH one blocked us in Metro.
  Object.entries(grants).forEach(([perm, state]) => {
    console.log(`[BLE] Permission ${perm}: ${state}`);
  });
  const allGranted = Object.values(grants).every(g => g === PermissionsAndroid.RESULTS.GRANTED);
  if (!allGranted) {
    // If any were "never_ask_again", the runtime prompt won't fire anymore —
    // farmer must toggle from OS Settings. Surface the settings shortcut.
    const anyNeverAsk = Object.values(grants).some(g => g === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    if (anyNeverAsk) {
      Alert.alert(
        'Permission needed',
        'KisanShakti needs Nearby devices + Location permission to find your ESP32 sensor. Please enable them in App Settings.\n\nಅಪ್ಲಿಕೇಶನ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಅನುಮತಿ ನೀಡಿ.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
    }
  }
  return allGranted;
}

// ══════════════════════════════════════════════════════════════════════════════
// ANIMATED WEATHER ICONS
// ══════════════════════════════════════════════════════════════════════════════

function useLoopedTiming(
  v: Animated.Value, to: number, duration: number,
  easing: (n: number) => number = Easing.linear,
) {
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(v, { toValue: to, duration, easing, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
}

function AnimatedSun({ size = 30 }: { size?: number }) {
  const rot = useRef(new Animated.Value(0)).current;
  useLoopedTiming(rot, 1, 8000);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', transform: [{ rotate: spin }] }}>
        <Ionicons name="sunny" size={size} color="#F59E0B" />
      </Animated.View>
    </View>
  );
}

function AnimatedPartly({ size = 30 }: { size?: number }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, []);
  const x = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name="sunny" size={size * 0.7} color="#F59E0B" style={{ position: 'absolute', top: 0, left: 0 }} />
      <Animated.View style={{ position: 'absolute', bottom: 0, right: 0, transform: [{ translateX: x }] }}>
        <Ionicons name="cloud" size={size * 0.78} color="#CBD5E1" />
      </Animated.View>
    </View>
  );
}

function AnimatedCloudy({ size = 30 }: { size?: number }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, []);
  const x = drift.interpolate({ inputRange: [0, 1], outputRange: [-3, 3] });
  return (
    <Animated.View style={{ transform: [{ translateX: x }] }}>
      <Ionicons name="cloud" size={size} color="#94A3B8" />
    </Animated.View>
  );
}

function AnimatedRainCloud({ size = 30 }: { size?: number }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = (v: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]));
    const a = loop(d1, 0), b = loop(d2, 300), c = loop(d3, 600);
    a.start(); b.start(); c.start();
    return () => { a.stop(); b.stop(); c.stop(); };
  }, []);
  const drop = (v: Animated.Value, left: number) => ({
    position: 'absolute' as const,
    left, top: size * 0.62, width: 2, height: 6, borderRadius: 1,
    backgroundColor: '#2563EB',
    opacity: v.interpolate({ inputRange: [0, 0.2, 0.85, 1], outputRange: [0, 1, 1, 0] }),
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.5] }) }],
  });
  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name="cloud" size={size * 0.85} color="#64748B" style={{ position: 'absolute', top: 0, left: size * 0.075 }} />
      <Animated.View style={drop(d1, size * 0.30)} />
      <Animated.View style={drop(d2, size * 0.48)} />
      <Animated.View style={drop(d3, size * 0.66)} />
    </View>
  );
}

function AnimatedThunder({ size = 30 }: { size?: number }) {
  const flash = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.delay(1200),
      Animated.timing(flash, { toValue: 1,   duration: 120, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0.3, duration: 220, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 1,   duration: 90,  useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0.3, duration: 500, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={{ width: size, height: size }}>
      <Ionicons name="cloud" size={size * 0.85} color="#475569" style={{ position: 'absolute', top: 0, left: size * 0.075 }} />
      <Animated.View style={{ position: 'absolute', bottom: 0, left: size * 0.32, opacity: flash }}>
        <MaterialCommunityIcons name="lightning-bolt" size={size * 0.6} color="#FBBF24" />
      </Animated.View>
    </View>
  );
}

function WeatherIcon({ kind, size }: { kind: WeatherKind; size?: number }) {
  switch (kind) {
    case 'sunny':   return <AnimatedSun size={size} />;
    case 'partly':  return <AnimatedPartly size={size} />;
    case 'cloudy':  return <AnimatedCloudy size={size} />;
    case 'rain':    return <AnimatedRainCloud size={size} />;
    case 'thunder': return <AnimatedThunder size={size} />;
    default:        return <AnimatedPartly size={size} />;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ADVISORY SCENES  (irrigation card animations)
// ══════════════════════════════════════════════════════════════════════════════

function AdvisoryRainScene() {
  const drops = useRef(
    Array.from({ length: 9 }).map((_, i) => ({
      anim:     new Animated.Value(0),
      left:     `${8 + i * 10.5}%`,
      duration: 1100 + (i % 3) * 260,
      delay:    i * 140,
    }))
  ).current;

  useEffect(() => {
    const anims = drops.map((d) =>
      Animated.loop(Animated.sequence([
        Animated.delay(d.delay),
        Animated.timing(d.anim, { toValue: 1, duration: d.duration, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(d.anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]))
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', top: -8, left: d.left as any,
            width: 2, height: 12, borderRadius: 1,
            backgroundColor: 'rgba(37, 99, 235, 0.65)',
            opacity: d.anim.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: d.anim.interpolate({ inputRange: [0, 1], outputRange: [-4, 110] }) },
              { rotate: '14deg' },
            ],
          }}
        />
      ))}
    </View>
  );
}

function DriftingCloud() {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 4200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, []);
  const x = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  return (
    <Animated.View pointerEvents="none"
      style={{ position: 'absolute', top: 6, right: 8, transform: [{ translateX: x }], opacity: 0.55 }}>
      <Ionicons name="cloud" size={38} color="#93C5FD" />
    </Animated.View>
  );
}

function AdvisoryHeroIcon({
  color, glow, icon,
}: { color: string; glow: string; icon: React.ReactNode }) {
  const shake = useRef(new Animated.Value(0)).current;
  const glowV = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(shake, { toValue: 1,  duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0,  duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(glowV, { toValue: 0.9, duration: 1200, useNativeDriver: true }),
      Animated.timing(glowV, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, []);
  const rot = shake.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] });
  return (
    <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute', width: 52, height: 52, borderRadius: 26,
        backgroundColor: glow, opacity: glowV,
      }} />
      <Animated.View style={{
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: color, alignItems: 'center', justifyContent: 'center',
        transform: [{ rotate: rot }],
      }}>
        {icon}
      </Animated.View>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BLE STATUS BADGE
// ══════════════════════════════════════════════════════════════════════════════

function PulsingRing() {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    const pulse = Animated.loop(Animated.parallel([
      Animated.sequence([
        Animated.timing(scale,   { toValue: 1.7, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale,   { toValue: 1,   duration: 600, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0,   duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.8, duration: 600, useNativeDriver: true }),
      ]),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, []);
  return <Animated.View style={[bleStyles.pulseRing, { transform: [{ scale }], opacity }]} />;
}

function BleStatusButton({ status, onPress, onLongPress }: {
  status: BleStatus; onPress: () => void; onLongPress: () => void;
}) {
  if (status === 'connected') {
    return (
      <TouchableOpacity style={[bleStyles.badge, bleStyles.badgeConnected]}
        onLongPress={onLongPress} delayLongPress={600} activeOpacity={0.8}>
        <View style={bleStyles.liveDot} />
        <Text style={bleStyles.badgeText}>Live · ನೇರ</Text>
      </TouchableOpacity>
    );
  }
  if (status === 'scanning') {
    return (
      <View style={[bleStyles.badge, bleStyles.badgeScanning]}>
        <View style={bleStyles.pulseWrapper}>
          <PulsingRing />
          <Ionicons name="bluetooth" size={14} color={COLORS.accentBlue} />
        </View>
        <Text style={[bleStyles.badgeText, { color: COLORS.accentBlue }]}>Scanning · ಹುಡುಕುತ್ತಿದೆ</Text>
      </View>
    );
  }
  if (status === 'connecting') {
    return (
      <View style={[bleStyles.badge, bleStyles.badgeScanning]}>
        <Ionicons name="bluetooth" size={14} color={COLORS.accentBlue} />
        <Text style={[bleStyles.badgeText, { color: COLORS.accentBlue }]}>Connecting · ಸಂಪರ್ಕ</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <TouchableOpacity style={[bleStyles.badge, bleStyles.badgeError]} onPress={onPress} activeOpacity={0.8}>
        <Ionicons name="refresh" size={14} color="#D97706" />
        <Text style={[bleStyles.badgeText, { color: '#D97706' }]}>Retry · ಮತ್ತೆ</Text>
      </TouchableOpacity>
    );
  }
  if (status === 'unavailable') {
    return (
      <View style={[bleStyles.badge, bleStyles.badgeError]}>
        <Ionicons name="cloud-outline" size={14} color="#D97706" />
        <Text style={[bleStyles.badgeText, { color: '#D97706' }]}>API mode · API</Text>
      </View>
    );
  }
  if (status === 'bt-off') {
    return (
      <TouchableOpacity style={[bleStyles.badge, bleStyles.badgeError]} onPress={onPress} activeOpacity={0.8}>
        <Ionicons name="bluetooth-outline" size={14} color="#D97706" />
        <Text style={[bleStyles.badgeText, { color: '#D97706' }]}>BT off · ಆಫ್</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity style={[bleStyles.badge, bleStyles.badgePair]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name="bluetooth" size={14} color={COLORS.bgCard} />
      <Text style={[bleStyles.badgeText, { color: COLORS.bgCard }]}>Pair · ಜೋಡಿಸಿ</Text>
    </TouchableOpacity>
  );
}

const bleStyles = StyleSheet.create({
  badge:          { borderRadius: RADII.pill, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1 },
  badgeConnected: { backgroundColor: '#E8F5E9', borderColor: '#C8E6C9' },
  badgeScanning:  { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  badgeError:     { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  badgePair:      { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  badgeText:      { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },
  liveDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  pulseWrapper:   { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pulseRing:      { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: COLORS.accentBlue },
});

// ══════════════════════════════════════════════════════════════════════════════
// GPS LOCATION HOOK
// ══════════════════════════════════════════════════════════════════════════════

function useGpsLocation() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  // True when we're using the Kolar fallback instead of real GPS. The screen
  // shows a banner in that case so the farmer knows the advice isn't tuned
  // to their exact plot.
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setPermError('Location permission denied');
          setUsingFallback(true);
          // Fallback to Kolar centre so the forecast still renders something.
          setCoords({ lat: 13.1367, lon: 78.1325 });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setUsingFallback(false);
      } catch (e: any) {
        console.warn('[gps]', e?.message);
        setPermError(e?.message || 'GPS failed');
        setUsingFallback(true);
        setCoords({ lat: 13.1367, lon: 78.1325 });
      }
    })();
  }, []);

  return { coords, permError, usingFallback };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ══════════════════════════════════════════════════════════════════════════════

export default function WeatherScreen() {
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [bleStatus, setBleStatus]   = useState<BleStatus>('disconnected');
  const [source, setSource]         = useState<DataSource>('none');

  const [forecast, setForecast]     = useState<ForecastDay[] | null>(null);
  const [next24Pct, setNext24Pct]   = useState<number | null>(null);
  const [currentKind, setCurrentKind] = useState<WeatherKind | null>(null);
  const [currentCondition, setCurrentCondition] = useState<{ en: string; kn: string } | null>(null);
  // Debounced LM393 state — flips only after RAIN_DEBOUNCE_FRAMES agreeing frames
  const [rainingDebounced, setRainingDebounced] = useState(false);
  const rainRunRef = useRef<{ value: boolean; count: number }>({ value: false, count: 0 });
  const [advisory, setAdvisory]     = useState<AgriAdvisory | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>('Karnataka · ಕರ್ನಾಟಕ');

  // WiFi pairing modal — farmer types 1-3 networks in priority order,
  // we relay them to the ESP32 over BLE. First entry = highest priority
  // (tried first on boot). Second is the backup (e.g. phone hotspot).
  // Third is a rarely-used fallback.
  const [wifiModal, setWifiModal]     = useState(false);
  const [wifiNets, setWifiNets]       = useState<{ ssid: string; pass: string }[]>([
    { ssid: '', pass: '' },
  ]);
  const [wifiSaving, setWifiSaving]   = useState(false);
  const MAX_WIFI_NETS = 3;

  // Pair-a-new-sensor wizard — a guided flow shown when the farmer taps
  // the Pair button on the no-sensor hero. Reuses the existing BLE logic
  // (bleStatus, connectToDevice, writeConfigToEsp) so nothing is duplicated.
  // Steps auto-advance on external signals (BLE connect, first reading).
  type WizStep = 'welcome' | 'scanning' | 'wifi' | 'sending' | 'success';
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizStep,    setWizStep]    = useState<WizStep>('welcome');
  const [wizError,   setWizError]   = useState<string | null>(null);
  const [wizNets,    setWizNets]    = useState<{ ssid: string; pass: string }[]>([
    { ssid: '', pass: '' },
  ]);
  const [wizPlotName, setWizPlotName] = useState('');

  // Cloud-latest reading (age in seconds relative to when the ESP32 posted it).
  // Populated by the backend poller; used as the primary source when BLE is
  // NOT connected and the cloud data is fresh enough.
  const [cloudAgeSec, setCloudAgeSec] = useState<number | null>(null);

  // Multi-sensor device switcher — shows a chip strip at the top only when
  // the farmer has ≥2 devices paired. Selection scopes the cloud poller
  // to that specific device_id so a farmer with a Tomato plot and a
  // Chilli plot can flip between them. Selection persists per-session.
  const [devices, setDevices]                 = useState<{
    device_id: string; label: string | null; age_seconds: number | null;
  }[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // (Rain-diary + soil-trend state removed — charts retired per farmer feedback.)

  // Aggregate backend-reachability flag. Flips false the moment any of
  // (forecast | advisory | cloud) fetch fails while we already have cached
  // data to show. The banner uses this to tell the farmer we're serving
  // stale-but-real values instead of pretending the server is fine.
  const [netOk, setNetOk] = useState(true);
  const lastForecastAtRef = useRef<number | null>(null);   // Date.now() of last good forecast
  const advisoryRef       = useRef<AgriAdvisory | null>(null);   // freshest ref so effect deps stay stable

  const { coords, usingFallback: gpsUsingFallback } = useGpsLocation();
  const { farmerId } = useAuth();
  // Kept in a ref so the useCallback-frozen connect handler always reads the
  // latest value even if BLE connected before login finished loading.
  const farmerIdRef = useRef<string | null>(null);
  useEffect(() => { farmerIdRef.current = farmerId; }, [farmerId]);

  // Snapshot of the WiFi SSIDs currently saved on the ESP32 (passwords
  // masked). Populated by reading the BLE characteristic right after
  // connect. Used to prefill the Setup/Change WiFi modal so the farmer
  // can see what's saved instead of a blank form.
  const [savedNetworks, setSavedNetworks] = useState<{ ssid: string; has_pass: boolean }[]>([]);
  // device_id read from the ESP32's saved-config snapshot on BLE connect.
  // Used to (a) match the connected sensor to a chip in the switcher and
  // (b) name the sensor in the WiFi modal ("Editing WiFi on Tomato plot").
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);

  const bleSubscription = useRef<Subscription | null>(null);
  const connectedDevice = useRef<Device | null>(null);
  const scanTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advisoryTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const forecastTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloudPollTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard: once we've handed the ESP32 its NVS config over BLE we don't
  // want to spam-write it every 5s BLE frame. Reset when we disconnect.
  const configPushedRef = useRef(false);

  // Compact hash that changes ONLY when a meaningful sensor transition
  // happens: 10-percentage-point soil-moisture bucket boundary crossed,
  // rain state flipped, or the sensor disappearing/appearing. Used as
  // the advisory effect's dep so per-5s BLE frames don't storm the
  // /agri-advisory endpoint with identical requests.
  const sensorBucket = React.useMemo(() => {
    if (!sensorData) return 'none';
    const soilBucket = Number.isFinite(sensorData.soil_moisture)
      ? Math.floor(sensorData.soil_moisture / 10)
      : -1;
    return `${soilBucket}|${sensorData.is_raining ? 1 : 0}`;
  }, [sensorData]);

  // Keep latest sensor snapshot in a ref so the interval reads freshest data,
  // and publish it into the cross-screen bus so Home's AI cards can use it.
  const sensorRef = useRef<SensorData | null>(null);
  useEffect(() => {
    sensorRef.current = sensorData;
    if (sensorData && source !== 'none') {
      publishSensor({ ...sensorData, source });
    } else if (!sensorData) {
      clearSensor();
    }

    // Debounce LM393. A dirty sensor / earlier-wet strip can flicker
    // between true/false — require RAIN_DEBOUNCE_FRAMES agreeing frames
    // before we tell the farmer "it's raining now".
    if (!sensorData || source !== 'sensor') {
      rainRunRef.current = { value: false, count: 0 };
      if (rainingDebounced) setRainingDebounced(false);
      return;
    }
    const observed = sensorData.is_raining;
    const run = rainRunRef.current;
    if (observed === run.value) {
      run.count += 1;
    } else {
      rainRunRef.current = { value: observed, count: 1 };
    }
    if (rainRunRef.current.count >= RAIN_DEBOUNCE_FRAMES && rainRunRef.current.value !== rainingDebounced) {
      setRainingDebounced(rainRunRef.current.value);
    }
  }, [sensorData, source, rainingDebounced]);

  // ── Cleanup helpers ──────────────────────────────────────────────────
  const clearScanTimeout = () => { if (scanTimeoutRef.current) { clearTimeout(scanTimeoutRef.current); scanTimeoutRef.current = null; } };
  const unsubscribeBle   = () => { bleSubscription.current?.remove(); bleSubscription.current = null; };

  const disconnectDevice = useCallback(async () => {
    clearScanTimeout();
    unsubscribeBle();
    try { bleManager.stopDeviceScan(); } catch (_) {}
    try {
      if (connectedDevice.current) {
        await connectedDevice.current.cancelConnection();
        connectedDevice.current = null;
      }
    } catch (_) {}
    setBleStatus('disconnected');
    setSource(coords ? 'weather-api' : 'none');
    setSensorData(null);
    configPushedRef.current = false;
    setSavedNetworks([]);   // clear per-device snapshot on disconnect
    setConnectedDeviceId(null);
  }, [coords]);

  // ── Reverse-geocode for a nice location label ────────────────────────
  useEffect(() => {
    if (!coords) return;
    (async () => {
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: coords.lat, longitude: coords.lon,
        });
        const r = results?.[0];
        if (r) {
          const city = r.city || r.subregion || r.district || r.name || 'Field';
          const region = r.region || '';
          setLocationLabel(`${city}, ${region}`);
        }
      } catch (_) {}
    })();
  }, [coords]);

  // ── Weather-API fallback: pretend the "sensor" is the reported weather
  // so the advisory can still fire when no ESP32 is around. Marked as
  // `source: weather-api` so the UI is honest about where the numbers came
  // from. Never fabricated — always the real live reading.
  const applyWeatherApiAsSensor = useCallback(async () => {
    if (!coords) return;
    // Abort early if a BLE connect is already in flight or live — the timeout
    // that triggered us fired before the ESP32's name resolved, but the connect
    // then succeeded. We must NOT clobber the real sensor with weather-API data.
    if (connectInFlightRef.current || connectedDevice.current) return;
    const w = await fetchWeather(coords.lat, coords.lon);
    if (!w) return;
    // Re-check after the await — connect may have completed while we were waiting on the network.
    if (connectInFlightRef.current || connectedDevice.current) return;
    setSensorData({
      soil_moisture: NaN,          // unknown without ESP32 — UI renders as "—"
      temperature:   w.temp_c,
      humidity:      w.humidity,
      is_raining:    (w.condition === 'Rain' || w.condition === 'Thunderstorm'),
    });
    setSource('weather-api');
  }, [coords]);

  // Guards to prevent overlapping connect attempts. React re-renders,
  // duplicated scan-callback fires for the same device, and the OS still
  // holding a stale connection would otherwise create a tight loop of
  // "already connected" / "operation cancelled" errors.
  const connectInFlightRef = useRef(false);
  const foundDeviceIdRef   = useRef<string | null>(null);

  // ── Write a config JSON to the ESP32 characteristic. Used to (a) hand it
  //    the backend URL + farmer_id on every fresh connect and (b) push new
  //    WiFi credentials from the "Setup WiFi" modal.
  const writeConfigToEsp = useCallback(async (payload: {
    ssid?: string; pass?: string;
    networks?: { ssid: string; pass: string }[];
    url?: string; farmerId?: string;
    // Per-device token issued by PATCH /sensor/devices/{id}. Relaying this
    // once via BLE lets the ESP32 authenticate its /reading POSTs forever.
    deviceToken?: string;
  }): Promise<boolean> => {
    const dev = connectedDevice.current;
    if (!dev) return false;
    try {
      const json = buildSensorConfigJson(payload);
      const b64  = Buffer.from(json, 'utf-8').toString('base64');
      await dev.writeCharacteristicWithResponseForService(
        SERVICE_UUID, TX_CHAR_UUID, b64
      );
      console.log('[BLE] wrote config:', json);
      return true;
    } catch (err) {
      console.warn('[BLE] config write failed:', err);
      return false;
    }
  }, []);

  // ── Real BLE ─────────────────────────────────────────────────────────
  const connectToDevice = useCallback(async (device: Device) => {
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;

    // If the OS still considers a previous session live, tear it down
    // first — otherwise .connect() throws "Device is already connected".
    try {
      const alreadyConnected = await device.isConnected();
      if (alreadyConnected) {
        await device.cancelConnection();
      }
    } catch (_) {}
    // Kill any lingering managed-level connection too (BleManager can hold
    // its own reference separate from the Device instance).
    try { await bleManager.cancelDeviceConnection(device.id); } catch (_) {}

    setBleStatus('connecting');
    try {
      const connected = await device.connect();

      // Default ATT MTU is 23 → only 20 payload bytes, which truncates
      // our ~65-byte sensor JSON. Request 247 (BLE 4.2 max) up-front.
      try {
        await connected.requestMTU(247);
      } catch (mtuErr) {
        console.warn('[BLE] MTU request failed (continuing with default):', mtuErr);
      }

      const discovered = await connected.discoverAllServicesAndCharacteristics();
      connectedDevice.current = discovered;
      setBleStatus('connected');
      setSource('sensor');

      const sub = discovered.monitorCharacteristicForService(
        SERVICE_UUID, TX_CHAR_UUID,
        (error, characteristic) => {
          if (error) { console.warn('[BLE] Monitor error', error); return; }
          const b64 = characteristic?.value;
          if (!b64) return;                     // ignore empty initial-subscribe callback
          try {
            const json = Buffer.from(b64, 'base64').toString('utf-8').trim();
            if (!json) return;                  // ignore whitespace-only frames
            // Guard partial frames: must at least start '{' and end '}'
            if (json[0] !== '{' || json[json.length - 1] !== '}') {
              console.warn('[BLE] Partial frame, skipping:', json);
              return;
            }
            const raw = JSON.parse(json);
            // The ESP32 uses the same characteristic for two payload shapes:
            //   1. Live sensor reading (fires every 5s)
            //   2. Saved-config snapshot (pushed once on connect)
            // We distinguish by the "kind" marker so neither corrupts the other.
            if (raw && raw.kind === 'saved-config') {
              if (Array.isArray(raw.networks)) {
                setSavedNetworks(raw.networks.map((n: any) => ({
                  ssid: String(n?.ssid || ''),
                  has_pass: Boolean(n?.has_pass),
                })));
              }
              if (typeof raw.dev === 'string' && raw.dev.length > 0) {
                setConnectedDeviceId(raw.dev);
              }
              return;
            }
            const data = raw as SensorData;
            if (typeof data.temperature !== 'number' || typeof data.humidity !== 'number') return;
            // Coerce missing battery to null explicitly so React doesn't
            // treat "field absent" and "field null" differently downstream.
            setSensorData({ ...data, battery_pct: data.battery_pct ?? null });
          } catch (parseErr) {
            console.warn('[BLE] JSON parse error', parseErr);
          }
        }
      );
      bleSubscription.current = sub;

      // One-shot READ right after subscribe: grabs the saved-config
      // snapshot the ESP32 published in its onConnect callback. Race-free
      // because reads return whatever setValue() last stored, regardless
      // of whether the sensor-loop has since overwritten it with a
      // reading (the reading arrives on notify, this read catches the
      // snapshot before that happens).
      try {
        const snapshot = await discovered.readCharacteristicForService(
          SERVICE_UUID, TX_CHAR_UUID,
        );
        const b64 = snapshot?.value;
        if (b64) {
          const json = Buffer.from(b64, 'base64').toString('utf-8').trim();
          if (json.startsWith('{') && json.endsWith('}')) {
            const parsed = JSON.parse(json);
            if (parsed?.kind === 'saved-config') {
              if (Array.isArray(parsed.networks)) {
                setSavedNetworks(parsed.networks.map((n: any) => ({
                  ssid: String(n?.ssid || ''),
                  has_pass: Boolean(n?.has_pass),
                })));
              }
              if (typeof parsed.dev === 'string' && parsed.dev.length > 0) {
                setConnectedDeviceId(parsed.dev);
              }
            }
          }
        }
      } catch (readErr) {
        console.warn('[BLE] saved-config read failed:', readErr);
      }

      // Silently hand the ESP32 the backend URL + farmer_id so its next
      // WiFi POST is tagged correctly. Only run once per BLE session.
      const fid = farmerIdRef.current;
      if (!configPushedRef.current && fid) {
        configPushedRef.current = true;
        // Small delay so the connection settles before the first write.
        setTimeout(() => {
          writeConfigToEsp({ url: API_BASE, farmerId: fid }).catch(() => {});
        }, 500);
      }
    } catch (err) {
      console.warn('[BLE] Connection error', err);
      setBleStatus('error');
      // Clear the "found" marker so a Pair retry can find & connect again.
      foundDeviceIdRef.current = null;
    } finally {
      connectInFlightRef.current = false;
    }
  }, []);

  // Guard: never fire a second scan/connect while one is already in flight
  // or a device is already live. React's StrictMode + Metro reloads + GPS
  // coord re-fires all try to double-invoke this otherwise.
  //
  // Note: we allow re-scan from 'error' and 'bt-off' — Pair should always
  // work from those states. Only reject when something's genuinely in flight.
  const startScan = useCallback(async () => {
    if (bleStatus === 'scanning' || bleStatus === 'connected') {
      return;
    }
    if (bleStatus === 'connecting' && connectInFlightRef.current) {
      return;
    }
    if (connectedDevice.current) {
      setBleStatus('connected');
      return;
    }

    // Reset per-scan guards so the scan-callback dedup works fresh.
    foundDeviceIdRef.current  = null;
    connectInFlightRef.current = false;

    // 1. Grant runtime permissions FIRST. On Android 12+ the native BT
    //    enable dialog silently no-ops unless BLUETOOTH_CONNECT is already
    //    granted — this was why the Turn-on button did nothing.
    const granted = await requestBLEPermissions();
    if (!granted) {
      console.warn('[BLE] Runtime permissions denied');
      setBleStatus('error');
      return;
    }

    // 2. Now check the BT radio state and pop the native enable dialog
    //    if needed.
    try {
      const state = await bleManager.state();
      console.log('[BLE] Current state before scan:', state);
      if (state !== 'PoweredOn') {
        if (Platform.OS === 'android') {
          const ok = await promptEnableBluetooth();
          if (!ok) {
            setBleStatus('bt-off');
            return;
          }
          // Wait for the radio to actually finish powering on before scanning.
          // Even after the user accepts, PoweredOn takes ~500-1500 ms to settle.
          const powered = await waitForBluetoothOn(6000);
          if (!powered) {
            console.warn('[BLE] BT did not reach PoweredOn within timeout');
            setBleStatus('bt-off');
            return;
          }
          console.log('[BLE] BT is now PoweredOn — proceeding to scan');
        } else {
          setBleStatus('bt-off');
          return;
        }
      }
    } catch (stateErr) {
      console.warn('[BLE] State check failed', stateErr);
    }

    setBleStatus('scanning');
    scanTimeoutRef.current = setTimeout(() => {
      // If a matching device was already spotted (name resolved) and a connect
      // is in flight or established, do NOT flip to API mode — the ESP32 is
      // right there, we just haven't finished the handshake yet.
      if (foundDeviceIdRef.current || connectInFlightRef.current || connectedDevice.current) {
        return;
      }
      bleManager.stopDeviceScan();
      setBleStatus('unavailable');
      applyWeatherApiAsSensor();
    }, SCAN_TIMEOUT_MS);

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.warn('[BLE] Scan error', error);
        clearScanTimeout();
        if (String(error?.message || '').toLowerCase().includes('powered off')) {
          setBleStatus('bt-off');
        } else {
          setBleStatus('error');
        }
        return;
      }
      if (device?.name === DEVICE_NAME) {
        // Dedup: scan callback fires many times for the same peripheral.
        // Only the first one should trigger a connect — subsequent fires
        // spawn parallel connects, hitting "already connected" and
        // "operation cancelled" in a loop.
        if (foundDeviceIdRef.current === device.id) return;
        foundDeviceIdRef.current = device.id;
        clearScanTimeout();
        bleManager.stopDeviceScan();
        connectToDevice(device);
      }
    });
  }, [bleStatus, connectToDevice, applyWeatherApiAsSensor]);

  // Watch for the user turning Bluetooth on/off from Quick Settings while
  // our screen is open. If they turned it on after previously declining,
  // auto-resume the scan (removes the yellow card + starts pairing).
  useEffect(() => {
    const sub = bleManager.onStateChange((state) => {
      if (state === 'PoweredOn' && bleStatus === 'bt-off') {
        startScan();
      } else if (state !== 'PoweredOn' && (bleStatus === 'connected' || bleStatus === 'scanning' || bleStatus === 'connecting')) {
        // BT went off mid-session. Properly tear down the BLE connection
        // (unsubscribe + drop connectedDevice.current) so the cloud poller
        // — which is gated behind "!connectedDevice.current" — takes over
        // on its next tick. Do NOT wipe sensorData: the last-known values
        // stay on screen until cloud refreshes them, and the source label
        // will flip to "ESP32 · WiFi · X min ago" once cloud data arrives.
        clearScanTimeout();
        unsubscribeBle();
        try { bleManager.stopDeviceScan(); } catch (_) {}
        try {
          connectedDevice.current?.cancelConnection().catch(() => {});
        } catch (_) {}
        connectedDevice.current = null;
        configPushedRef.current = false;
        setSavedNetworks([]);
        setConnectedDeviceId(null);
        setBleStatus('bt-off');
        // Flip the source label to indicate we're no longer live-BLE.
        // Cloud poller will overwrite this to 'wifi-remote' if it gets data.
        setSource(prev => prev === 'sensor' ? 'weather-api' : prev);
      }
    }, true);
    return () => sub.remove();
  }, [bleStatus, startScan]);

  // Auto-start a scan only ONCE per screen mount. We first check BT state
  // *silently* — if it's off, we just set the yellow card and wait for the
  // farmer to tap Pair (which then fires the native runtime prompt). This
  // avoids popping the OS dialog before the farmer has even seen the screen.
  const hasScannedRef = useRef(false);
  useEffect(() => {
    if (!coords || hasScannedRef.current) return;
    hasScannedRef.current = true;
    (async () => {
      try {
        const state = await bleManager.state();
        if (state !== 'PoweredOn') {
          setBleStatus('bt-off');
          return;
        }
      } catch (_) {}
      startScan();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords]);

  // ── Fetch forecast on GPS ready, then every 30 min ───────────────────
  useEffect(() => {
    if (!coords) return;
    const load = async () => {
      const fc = await fetchForecast(coords.lat, coords.lon, 7);
      if (fc?.status === 'ok') {
        setForecast(fc.days);
        setNext24Pct(fc.next_24h_rain_pct);
        if (fc.current) {
          setCurrentKind(fc.current.kind);
          setCurrentCondition({ en: fc.current.condition, kn: fc.current.condition_kn });
        }
        lastForecastAtRef.current = Date.now();
        setNetOk(true);
      } else {
        // Backend unreachable OR bad response. Keep the last-known forecast
        // in state so the tiles don't blank out — the offline banner below
        // tells the farmer we're serving stale data.
        setNetOk(false);
        if (lastForecastAtRef.current == null) {
          // We never got a forecast this session — genuine empty state.
          setForecast([]);
          setNext24Pct(null);
          setCurrentKind(null);
          setCurrentCondition(null);
        }
      }
    };
    load();
    forecastTimer.current = setInterval(load, FORECAST_REFRESH_MS);
    return () => { if (forecastTimer.current) clearInterval(forecastTimer.current); };
  }, [coords]);

  // (Rain-diary poller removed — chart was retired per farmer feedback.
  // The endpoint /api/v1/weather/rain-diary is still available for
  // future features like a rainfall-history admin view.)

  // ── Fetch advisory whenever sensor snapshot changes, and every 5 min ─
  useEffect(() => {
    if (!coords) return;
    const load = async () => {
      const s = sensorRef.current;
      const adv = await fetchAgriAdvisory({
        lat: coords.lat, lon: coords.lon,
        soilMoisture:    s && Number.isFinite(s.soil_moisture) ? s.soil_moisture : undefined,
        sensorTemp:      s ? s.temperature : undefined,
        sensorHumidity:  s ? s.humidity    : undefined,
        sensorIsRaining: s ? s.is_raining  : undefined,
        farmerId:        farmerId ?? undefined,
      });
      if (adv) {
        setAdvisory(adv);
        advisoryRef.current = adv;
        setNetOk(true);
      } else {
        // Advisory endpoint unreachable — keep the last advisory visible.
        // Only flip netOk down if we HAVE a stale advisory to fall back on;
        // a genuine cold-start miss would just show the "Loading…" state.
        if (advisoryRef.current) setNetOk(false);
      }
    };
    load();
    advisoryTimer.current = setInterval(load, ADVISORY_REFRESH_MS);
    return () => { if (advisoryTimer.current) clearInterval(advisoryTimer.current); };
    // IMPORTANT: use the bucketed sensor signal, not the raw sensorData,
    // so we don't tear-down + refire this effect (and the HTTP request
    // inside it) on every 5-second BLE frame. The advisory only cares
    // about meaningful transitions — soil bucket change or rain flip —
    // not the 3rd decimal place of soil moisture drifting frame-to-frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, sensorBucket, farmerId]);

  // ── Load the farmer's paired-device list, refreshed every 2 min.
  //    Feeds the device-switcher chip strip. Also runs after the pair
  //    wizard completes so a new sensor appears without waiting for the
  //    next 2-min tick.
  useEffect(() => {
    if (!farmerId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await fetchSensorDevices();
        if (!cancelled) setDevices(list ?? []);
      } catch (_) { /* keep last-known device list on failure */ }
    };
    load();
    const t = setInterval(load, 2 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [farmerId, wizStep]);   // wizStep re-fires so post-pairing the list refreshes

  // ── Wizard success side-effect: (a) claim + persist plot nickname, and
  //    (b) obtain a device_token for this ESP32 and relay it over BLE so
  //    the very next /reading POST authenticates. Skipping this leaves the
  //    device in "grandfathered no-token" mode — insecure for production.
  //
  //    Best source of the device_id is `connectedDeviceId` (from the BLE
  //    saved-config snapshot). If BLE dropped before we captured it we
  //    fall back to polling /devices for a newly-appeared row.
  useEffect(() => {
    if (wizStep !== 'success') return;
    if (!farmerId) return;
    const nickname = wizPlotName.trim();

    let cancelled = false;
    (async () => {
      const deadline = Date.now() + 2 * 60_000;
      let deviceIdToPatch: string | null = connectedDeviceId;
      const seenBefore = new Set<string>();
      if (!deviceIdToPatch) {
        try {
          const before = await fetchSensorDevices();
          (before ?? []).forEach(d => seenBefore.add(d.device_id));
        } catch (_) { /* transient; loop below still tries */ }
      }

      while (!deviceIdToPatch && Date.now() < deadline && !cancelled) {
        await new Promise(r => setTimeout(r, 10_000));
        if (cancelled) return;
        try {
          const now = await fetchSensorDevices();
          const fresh = (now ?? []).filter(d => !seenBefore.has(d.device_id));
          if (fresh.length > 0) { deviceIdToPatch = fresh[0].device_id; break; }
        } catch (_) { /* keep polling */ }
      }

      if (!deviceIdToPatch || cancelled) return;

      try {
        // PATCH claims the sensor for the caller AND returns a device_token
        // (generated server-side on first pair, kept forever thereafter).
        const patched = await updateSensorDevice(deviceIdToPatch, {
          ...(nickname ? { label: nickname } : {}),
        });
        // Relay the token to the ESP32 over BLE. Silent-failure if BLE isn't
        // live any more — next Setup-WiFi write will re-attach the token.
        if (patched?.device_token) {
          await writeConfigToEsp({ deviceToken: patched.device_token }).catch(() => {});
        }
      } catch (_) { /* wizard already shows success; retry on next connect */ }
    })();

    return () => { cancelled = true; };
  }, [wizStep, wizPlotName, farmerId, connectedDeviceId, writeConfigToEsp]);

  // ── Wizard auto-advance: BLE-connected → move to WiFi step. Any BLE
  //    failure while wizard is scanning → surface an error banner in-flow.
  useEffect(() => {
    if (!wizardOpen) return;
    if (wizStep === 'scanning' && bleStatus === 'connected') {
      setWizError(null);
      setWizStep('wifi');
    } else if (wizStep === 'scanning' && (bleStatus === 'error' || bleStatus === 'unavailable' || bleStatus === 'bt-off')) {
      setWizError(
        bleStatus === 'bt-off'
          ? 'Please turn on Bluetooth and try again'
          : "Couldn't find the sensor — make sure it's powered on and within 3 metres"
      );
    }
  }, [wizardOpen, wizStep, bleStatus]);

  // (Soil-moisture trend poller removed — chart was retired per farmer
  // feedback. /api/v1/sensor/history stays available for future analytics.)

  // ── Cloud-latest poller: read the last reading the ESP32 pushed to the
  //    backend over WiFi. This is the "check my field from anywhere" path.
  //
  //    Priority rule when both sources have data:
  //      BLE (5s fresh)  >  cloud (~5 min fresh)  >  weather-API fallback
  //    So we only apply cloud data when BLE is NOT actively feeding sensorData.
  useEffect(() => {
    if (!farmerId) return;
    const load = async () => {
      // BLE takes precedence — skip cloud read if we're already streaming.
      if (connectedDevice.current) return;
      let cloud: Awaited<ReturnType<typeof fetchSensorLatest>> | null = null;
      try {
        // Filter to the selected device when the farmer picked one via
        // the device switcher; otherwise "latest across all my sensors"
        // (backend derives caller from JWT — no farmer_id in URL).
        cloud = await fetchSensorLatest(
          selectedDeviceId ? { deviceId: selectedDeviceId } : {}
        );
      } catch (_) {
        cloud = null;   // treat exception as "unreachable"
      }
      if (cloud == null) {
        // Distinguish "backend unreachable" from "backend replied with null":
        //   - unreachable → keep previous cloudAgeSec so tiles stay populated
        //   - genuine null (never a reading) → set null so the "no sensor" hero shows
        // We can't distinguish for sure from here, but the safest UX is:
        // keep whatever we had; the offline banner will explain.
        setNetOk(false);
        return;
      }
      // Double-check after the await — a BLE connect may have raced in.
      if (connectedDevice.current) return;
      setNetOk(true);
      setCloudAgeSec(cloud.age_seconds);
      setSensorData({
        soil_moisture: cloud.soil_moisture ?? NaN,
        temperature:   cloud.temperature   ?? NaN,
        humidity:      cloud.humidity      ?? NaN,
        is_raining:    cloud.is_raining    ?? false,
        battery_pct:   cloud.battery_pct,
      });
      setSource('wifi-remote');
    };
    load();
    cloudPollTimer.current = setInterval(load, CLOUD_SENSOR_POLL_MS);
    return () => { if (cloudPollTimer.current) clearInterval(cloudPollTimer.current); };
  }, [farmerId, selectedDeviceId]);

  // ── Component unmount cleanup ────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearScanTimeout();
      unsubscribeBle();
      if (advisoryTimer.current) clearInterval(advisoryTimer.current);
      if (forecastTimer.current) clearInterval(forecastTimer.current);
      if (cloudPollTimer.current) clearInterval(cloudPollTimer.current);
      try { bleManager.stopDeviceScan(); } catch (_) {}
      connectedDevice.current?.cancelConnection().catch(() => {});
    };
  }, []);

  const handleBlePress = () => {
    if (
      bleStatus === 'disconnected' || bleStatus === 'error' ||
      bleStatus === 'unavailable' || bleStatus === 'bt-off'
    ) startScan();
  };
  const handleLongPress = () => {
    if (bleStatus === 'connected') disconnectDevice();
  };

  // ── Render helpers ───────────────────────────────────────────────────
  const showValue = (v: number | undefined | null, suffix = '') =>
    (v == null || Number.isNaN(v)) ? '—' : `${v}${suffix}`;

  const sensorSourceLabel = () => {
    const battSuffix =
      sensorData?.battery_pct != null ? `  🔋${sensorData.battery_pct}%` : '';
    if (source === 'sensor')       return 'ESP32 · ನೇರ ಸಂವೇದಕ' + battSuffix;
    if (source === 'wifi-remote') {
      if (cloudAgeSec == null) return 'ESP32 · WiFi' + battSuffix;
      const { en } = ageLabel(cloudAgeSec);
      return `ESP32 · WiFi · ${en}${battSuffix}`;
    }
    if (source === 'weather-api')  return 'Weather API · API ಮೂಲ';
    return '—';
  };

  // Friendly name for the BLE-connected sensor. Falls back to the device_id
  // when the farmer hasn't set a nickname (or the /devices row hasn't yet
  // caught up with the ESP32's first push).
  const connectedDeviceLabel = (() => {
    if (!connectedDeviceId) return null;
    const row = devices.find(d => d.device_id === connectedDeviceId);
    return row?.label || connectedDeviceId;
  })();

  // True when the farmer has picked a device chip that DOESN'T match the
  // ESP32 they're BLE-connected to. Sensor tiles and cloud data reflect
  // the chip; a Setup-WiFi tap would edit the BLE-connected sensor's WiFi.
  // Surfacing this mismatch prevents "wait, why did my Tomato plot get
  // Chilli plot's WiFi?" confusion.
  const deviceMismatch =
    bleStatus === 'connected' &&
    connectedDeviceId != null &&
    selectedDeviceId != null &&
    selectedDeviceId !== connectedDeviceId;

  // True when the cloud reading is older than our staleness threshold — the
  // ESP32 has probably lost WiFi. We surface this so the farmer doesn't
  // trust old numbers.
  const cloudIsStale =
    source === 'wifi-remote' && cloudAgeSec != null && cloudAgeSec > CLOUD_STALE_THRESHOLD_S;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        // Android-only: detach off-screen children from the native view
        // hierarchy. Weather tab has 15+ full-width sections + animated
        // icons; this cuts paint work when the farmer scrolls fast.
        removeClippedSubviews
      >

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Weather & Field</Text>
            <Text style={styles.titleKn}>ಹವಾಮಾನ ಮತ್ತು ಹೊಲ</Text>
            <Text style={styles.subtitle}>{locationLabel} · {sensorSourceLabel()}</Text>
          </View>
          <BleStatusButton status={bleStatus} onPress={handleBlePress} onLongPress={handleLongPress} />
        </View>

        {/* ── Bluetooth-off card ── clean two-line layout with a real
              CTA button so the tap target is obvious. */}
        {bleStatus === 'bt-off' && (
          <View style={styles.btOffCard}>
            <View style={styles.btOffLeft}>
              <View style={styles.btOffIconRing}>
                <Ionicons name="bluetooth" size={20} color={COLORS.bgCard} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.btOffTitle}>Turn on Bluetooth</Text>
                <Text style={styles.btOffTitleKn}>ಬ್ಲೂಟೂತ್ ಆನ್ ಮಾಡಿ</Text>
                <Text style={styles.btOffMsg}>
                  Needed to connect your ESP32 sensor · ESP32 ಗೆ ಅವಶ್ಯಕ
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.btOffCta}
              activeOpacity={0.85}
              onPress={handleBlePress}
            >
              <Ionicons name="power" size={14} color={COLORS.bgCard} />
              <Text style={styles.btOffCtaText}>Turn on</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── GPS fell back to Kolar centre — advice is only approximate ── */}
        {gpsUsingFallback && (
          <TouchableOpacity
            style={styles.gpsFallbackCard}
            activeOpacity={0.85}
            onPress={() => Linking.openSettings()}
          >
            <Ionicons name="location-outline" size={18} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.gpsFallbackTitle}>
                Using approximate location (Kolar)
              </Text>
              <Text style={styles.gpsFallbackMsg}>
                Turn on GPS for weather at your field · ನಿಖರ ಸ್ಥಳಕ್ಕಾಗಿ GPS ಆನ್ ಮಾಡಿ
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#92400E" />
          </TouchableOpacity>
        )}

        {/* ── Offline / server-unreachable banner ── */}
        {!netOk && (forecast || advisoryRef.current || cloudAgeSec != null) && (
          <View style={styles.offlineCard}>
            <Ionicons name="cloud-offline-outline" size={16} color="#78350F" />
            <Text style={styles.offlineText}>
              Showing last known — reconnecting… · ಪುನಃ ಸಂಪರ್ಕ
            </Text>
          </View>
        )}

        {/* ── Device mismatch: chip selection vs BLE-connected ESP32 ── */}
        {deviceMismatch && (
          <View style={styles.mismatchCard}>
            <Ionicons name="swap-horizontal" size={16} color="#B45309" />
            <Text style={styles.mismatchText}>
              Bluetooth is on {connectedDeviceLabel} but you're viewing{' '}
              {devices.find(d => d.device_id === selectedDeviceId)?.label || 'another plot'}.
              Setup WiFi would edit {connectedDeviceLabel}.
            </Text>
          </View>
        )}

        {/* ── Low-battery warning: ESP32 running dry ── */}
        {sensorData?.battery_pct != null && sensorData.battery_pct <= BATT_CRITICAL_PCT && (
          <View style={styles.lowBattCard}>
            <Ionicons name="battery-dead-outline" size={18} color="#B91C1C" />
            <View style={{ flex: 1 }}>
              <Text style={styles.lowBattTitle}>
                Sensor battery low ({sensorData.battery_pct}%)
              </Text>
              <Text style={styles.lowBattMsg}>
                Change batteries soon — ESP32 will stop pushing readings when it runs out.
                {"\n"}
                ಬ್ಯಾಟರಿ ಬದಲಾಯಿಸಿ · ಸಂವೇದಕ ನಿಲ್ಲುತ್ತದೆ.
              </Text>
            </View>
          </View>
        )}

        {/* ── Cloud-stale warning: ESP32 hasn't pushed a reading in a while ── */}
        {cloudIsStale && cloudAgeSec != null && (
          <View style={styles.staleCard}>
            <Ionicons name="cloud-offline-outline" size={18} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.staleTitle}>
                Sensor last reported {ageLabel(cloudAgeSec).en}
              </Text>
              <Text style={styles.staleMsg}>
                Check its power and WiFi router · ವಿದ್ಯುತ್ / ವೈಫೈ ಪರಿಶೀಲಿಸಿ
              </Text>
            </View>
          </View>
        )}

        {/* ── Irrigation Advisory ── */}
        <View style={[
          styles.advisoryCard,
          advisory?.irrigation.level === 'low' && styles.advisoryCardLow,
        ]}>
          {advisory?.irrigation.level !== 'low' && <AdvisoryRainScene />}
          <DriftingCloud />

          <AdvisoryHeroIcon
            color={COLORS.bgCard}
            glow="rgba(147, 197, 253, 0.55)"
            icon={<FontAwesome5 name="umbrella" size={22} color={COLORS.primaryDark} />}
          />

          <View style={{ flex: 1, zIndex: 10 }}>
            <View style={styles.advisoryHeaderRow}>
              <Text style={styles.advisoryHeader}>Irrigation Advisory · ನೀರಾವರಿ ಸಲಹೆ</Text>
              {advisory?.crop_context && (
                <View style={styles.cropStagePill}>
                  <Text style={styles.cropStagePillText}>
                    {advisory.crop_context.crop_name} · {advisory.crop_context.days_since_sowing}d
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.advisoryTitle}>{advisory?.irrigation.title ?? 'Loading…'}</Text>
            <Text style={styles.advisoryTitleKn}>{advisory?.irrigation.title_kn ?? 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…'}</Text>
            <Text style={styles.advisoryMsg}>{advisory?.irrigation.message ?? ''}</Text>
            <Text style={styles.advisoryMsgKn}>{advisory?.irrigation.message_kn ?? ''}</Text>
          </View>
        </View>

        {/* ── Fungal Risk + Spray Window (only when actionable) ──
            Hide fungal card when risk is low.
            Hide spray card when spraying is not advised right now.
            If neither is actionable, skip the whole row entirely. */}
        {(() => {
          const showFungal = advisory?.fungal.level === 'medium' || advisory?.fungal.level === 'high';
          const showSpray  = advisory?.spray.ok === true;
          if (!showFungal && !showSpray) return null;
          return (
            <View style={styles.advisoryRow}>
              {showFungal && (
                <View style={[
                  styles.miniAdvisory,
                  advisory!.fungal.level === 'high'   && styles.miniAdvisoryDanger,
                  advisory!.fungal.level === 'medium' && styles.miniAdvisoryWarn,
                ]}>
                  <View style={styles.miniAdvisoryTop}>
                    <MaterialCommunityIcons name="mushroom-outline" size={18} color={
                      advisory!.fungal.level === 'high' ? '#B91C1C' : '#B45309'
                    } />
                    <Text style={styles.miniAdvisoryHead}>Fungal Risk · ಶಿಲೀಂಧ್ರ</Text>
                  </View>
                  <Text style={styles.miniAdvisoryTitle}>{advisory!.fungal.title}</Text>
                  <Text style={styles.miniAdvisoryTitleKn}>{advisory!.fungal.title_kn}</Text>
                  <Text style={styles.miniAdvisoryMsg} numberOfLines={3}>{advisory!.fungal.message}</Text>
                </View>
              )}

              {showSpray && (
                <View style={[styles.miniAdvisory, styles.miniAdvisoryOk]}>
                  <View style={styles.miniAdvisoryTop}>
                    <MaterialCommunityIcons name="spray" size={18} color={COLORS.primary} />
                    <Text style={styles.miniAdvisoryHead}>Spray Window · ಸಿಂಪರಣೆ</Text>
                  </View>
                  <Text style={styles.miniAdvisoryTitle}>{advisory!.spray.title}</Text>
                  <Text style={styles.miniAdvisoryTitleKn}>{advisory!.spray.title_kn}</Text>
                  <Text style={styles.miniAdvisoryMsg} numberOfLines={3}>{advisory!.spray.message}</Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* ── No-sensor-yet hero: help farmers who haven't paired yet ──
              Shows only when NO sensor is contributing data at all —
              not connected via BLE, no cloud reading ever received, and
              the app isn't already mid-pairing. Hidden the moment any
              real sensor data lands. */}
        {source !== 'sensor' &&
         source !== 'wifi-remote' &&
         cloudAgeSec == null &&
         (bleStatus === 'disconnected' || bleStatus === 'unavailable' || bleStatus === 'error') && (
          <View style={styles.noSensorCard}>
            <View style={styles.noSensorIcon}>
              <MaterialCommunityIcons name="broadcast" size={22} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.noSensorTitle}>Connect your ESP32 sensor</Text>
              <Text style={styles.noSensorTitleKn}>ನಿಮ್ಮ ESP32 ಸಂವೇದಕ ಸಂಪರ್ಕಿಸಿ</Text>
              <Text style={styles.noSensorMsg}>
                See real soil moisture, temperature and rainfall from your field.
                {"\n"}
                ಹೊಲದ ನೇರ ಮಾಹಿತಿ ನೋಡಿ.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.noSensorCta}
              activeOpacity={0.85}
              onPress={() => {
                // Reset wizard state to a clean welcome screen. We do NOT
                // start BLE yet — the farmer taps Start on the welcome step
                // so the OS permission prompt fires with clear intent.
                setWizStep('welcome');
                setWizError(null);
                setWizNets([{ ssid: '', pass: '' }]);
                setWizPlotName('');
                setWizardOpen(true);
              }}
            >
              <Ionicons name="bluetooth" size={14} color={COLORS.bgCard} />
              <Text style={styles.noSensorCtaText}>Pair</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Device switcher — appears once the farmer owns any sensor.
              A single-device farmer needs it too, because that's where
              the "+ Add another plot" affordance lives. Tapping a chip
              scopes the cloud reading + sensor grid to that device.
              The "All" chip goes back to "latest across every sensor". */}
        {devices.length >= 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.deviceChipRow}
          >
            {/* Only show "All" when there are ≥ 2 devices to switch between. */}
            {devices.length >= 2 && (
              <TouchableOpacity
                style={[styles.deviceChip, !selectedDeviceId && styles.deviceChipActive]}
                activeOpacity={0.85}
                onPress={() => setSelectedDeviceId(null)}
              >
                <Text style={[styles.deviceChipText, !selectedDeviceId && styles.deviceChipTextActive]}>All</Text>
              </TouchableOpacity>
            )}
            {devices.map(d => {
              const active   = selectedDeviceId === d.device_id;
              const stale    = d.age_seconds != null && d.age_seconds > CLOUD_STALE_THRESHOLD_S;
              const bleHere  = bleStatus === 'connected' && connectedDeviceId === d.device_id;
              return (
                <TouchableOpacity
                  key={d.device_id}
                  style={[styles.deviceChip, active && styles.deviceChipActive]}
                  activeOpacity={0.85}
                  onPress={() => setSelectedDeviceId(d.device_id)}
                >
                  {/* BT badge on the chip we're BLE-connected to, so farmer
                      can see at a glance "this is the one I'm near". */}
                  {bleHere && (
                    <Ionicons name="bluetooth" size={12} color={COLORS.accentBlue} />
                  )}
                  {/* Fresh dot = green, stale = amber, never-seen = grey */}
                  <View style={[
                    styles.deviceChipDot,
                    d.age_seconds == null && { backgroundColor: '#94A3B8' },
                    d.age_seconds != null && !stale && { backgroundColor: '#10B981' },
                    stale && { backgroundColor: '#F59E0B' },
                  ]} />
                  <Text style={[styles.deviceChipText, active && styles.deviceChipTextActive]} numberOfLines={1}>
                    {d.label || d.device_id}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {/* Always-present "add another plot" affordance. Opens the same
                pair wizard we use for the very first sensor. Uses filled
                primary style so the text stays legible in every theme
                (the earlier dashed-outline chip clipped its label on
                some Android builds). */}
            <TouchableOpacity
              style={styles.deviceChipAdd}
              activeOpacity={0.85}
              onPress={() => {
                setWizStep('welcome');
                setWizError(null);
                setWizNets([{ ssid: '', pass: '' }]);
                setWizPlotName('');
                setWizardOpen(true);
              }}
            >
              <Ionicons name="add" size={16} color={COLORS.bgCard} />
              <Text style={styles.deviceChipAddText}>Add plot</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── Live Field Sensors ── */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <MaterialCommunityIcons name="broadcast" size={18} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>{t('Live Field Sensors', 'ನೇರ ಹೊಲ ಸಂವೇದಕಗಳು')}</Text>
          </View>
          <Text style={styles.fieldTag}>{sensorSourceLabel()}</Text>
        </View>

        {/* Setup / Change WiFi — only meaningful while BLE is live */}
        {bleStatus === 'connected' && (
          <TouchableOpacity
            style={styles.setupWifiBtn}
            activeOpacity={0.85}
            onPress={() => {
              // Prefill slots from what the ESP32 says it has saved. Passwords
              // are always blank (they're masked on-device) so the farmer can
              // leave a slot untouched (empty pass = keep the existing one on
              // the ESP32 if the ssid matches, else replace).
              const prefill = savedNetworks.length > 0
                ? savedNetworks.slice(0, MAX_WIFI_NETS).map(n => ({ ssid: n.ssid, pass: '' }))
                : [{ ssid: '', pass: '' }];
              setWifiNets(prefill);
              setWifiModal(true);
            }}
          >
            <Ionicons name="wifi" size={14} color={COLORS.primaryDark} />
            <Text style={styles.setupWifiText}>
              {savedNetworks.length > 0
                ? t(`WiFi (${savedNetworks.length} saved)`, `ವೈಫೈ (${savedNetworks.length} ಉಳಿಸಲಾಗಿದೆ)`)
                : t('Setup WiFi', 'ವೈಫೈ ಹೊಂದಿಸಿ')}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.sensorGrid}>
          <SensorCell
            iconName="water-outline" iconColor={COLORS.primary}
            en="Soil Moisture" kn="ಮಣ್ಣಿನ ತೇವಾಂಶ"
            value={showValue(sensorData?.soil_moisture, '%')}
            sub={source === 'sensor' ? 'Capacitive · ಕೆಪ್ಯಾಸಿಟಿವ್' : 'Needs ESP32 · ESP32 ಬೇಕು'}
            fillPct={sensorData && Number.isFinite(sensorData.soil_moisture) ? sensorData.soil_moisture : 0}
            fillColor="#2563EB"
          />
          <SensorCell
            iconName="thermometer-outline" iconColor={COLORS.accentAmber}
            en="Temperature" kn="ಉಷ್ಣಾಂಶ"
            value={showValue(sensorData?.temperature, '°C')}
            sub={source === 'sensor' ? 'DHT22' : 'Weather API · API'}
            fillPct={sensorData ? (sensorData.temperature / 50) * 100 : 0}
            fillColor={COLORS.accentAmber}
          />
          <SensorCell
            iconName="cloud-outline" iconColor="#00BCD4"
            en="Humidity" kn="ಆರ್ದ್ರತೆ"
            value={showValue(sensorData?.humidity, '%')}
            sub={source === 'sensor' ? 'DHT22' : 'Weather API · API'}
            fillPct={sensorData?.humidity ?? 0}
            fillColor="#00BCD4"
          />
          <SensorCell
            iconName="rainy-outline" iconColor={COLORS.primary}
            en="Rainfall" kn="ಮಳೆ"
            value={sensorData == null ? '—' : (sensorData.is_raining ? 'Raining' : 'None')}
            // Never claim "no rain" when there's no sensor — the honesty rule
            // says show unavailable rather than default to a false negative.
            sub={
              sensorData == null
                ? 'Needs ESP32'
                : sensorData.is_raining ? 'ಮಳೆ ಬರುತ್ತಿದೆ' : 'ಮಳೆ ಇಲ್ಲ'
            }
            fillPct={sensorData?.is_raining ? 100 : 5}
            fillColor={COLORS.primary}
          />
        </View>

        {/* Soil-moisture 24h trend chart removed per farmer feedback —
            the current-value tile is what farmers actually act on.
            The /sensor/history endpoint is still available for the
            admin dashboard when we build that. */}

        {/* ── Regional Forecast (Open-Meteo, 7-day) ── */}
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{t('Regional Forecast', 'ಪ್ರಾದೇಶಿಕ ಮುನ್ಸೂಚನೆ')}</Text>
          </View>
          <Text style={styles.fieldTag}>Open-Meteo</Text>
        </View>

        <View style={styles.forecastCard}>
          {next24Pct != null && (
            <View style={styles.forecastRainRow}>
              <Ionicons name="rainy" size={16} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.forecastRainText}>
                  {next24Pct}% rain in next 24h
                </Text>
                <Text style={styles.forecastRainTextKn}>
                  ಮುಂದಿನ 24 ಗಂಟೆಯಲ್ಲಿ {next24Pct}% ಮಳೆ
                </Text>
              </View>
            </View>
          )}

          {forecast == null && (
            <Text style={styles.forecastLoading}>Loading forecast… · ಲೋಡ್ ಆಗುತ್ತಿದೆ…</Text>
          )}
          {forecast != null && forecast.length === 0 && (
            <Text style={styles.forecastLoading}>
              Forecast unavailable · ಮುನ್ಸೂಚನೆ ಲಭ್ಯವಿಲ್ಲ
            </Text>
          )}

          {forecast != null && forecast.length > 0 && (() => {
            // Today's kind: LM393 sensor > current-weather API > forecast aggregate.
            // A farmer standing in the rain shouldn't see a sunny icon for today.
            // Uses the DEBOUNCED LM393 signal so a single noisy frame won't flip it.
            const rainingByLm393 = rainingDebounced && source === 'sensor';
            const todayKindOverride: WeatherKind | null =
              rainingByLm393 ? 'rain' :
              (currentKind && (currentKind === 'rain' || currentKind === 'thunder') ? currentKind : null);
            return (
              <View style={styles.forecastGrid}>
                {forecast.slice(0, 5).map((f, i) => {
                  const kind = i === 0 && todayKindOverride ? todayKindOverride : f.kind;
                  return (
                    <View key={f.date} style={[styles.forecastItem, i === 0 && styles.forecastItemToday]}>
                      <Text style={[styles.forecastDay, i === 0 && styles.forecastDayToday]}>{f.day_en}</Text>
                      <Text style={[styles.forecastDayKn, i === 0 && styles.forecastDayToday]}>{f.day_kn}</Text>

                      <View style={styles.forecastIconWrap}>
                        <WeatherIcon kind={kind} size={30} />
                      </View>

                      <Text style={styles.forecastHigh}>
                        {f.high_c != null ? `${Math.round(f.high_c)}°` : '—'}
                      </Text>
                      <Text style={styles.forecastLow}>
                        {f.low_c != null ? `${Math.round(f.low_c)}°` : ''}
                      </Text>
                      <Text style={styles.forecastPct}>{f.rain_pct}%</Text>
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Ground-truth banner. Shows the exact source in a subtitle so the
              farmer (and I during debugging) can tell WHY it's firing. */}
          {rainingDebounced && source === 'sensor' && (
            <View style={styles.rainingNowBanner}>
              <Ionicons name="rainy" size={16} color="#1E40AF" />
              <Text style={styles.rainingNowText}>
                Raining now · ಈಗ ಮಳೆ ಬರುತ್ತಿದೆ
              </Text>
            </View>
          )}
          {!rainingDebounced && currentCondition && (currentKind === 'rain' || currentKind === 'thunder') && (
            <View style={styles.rainingNowBanner}>
              <Ionicons name="rainy" size={16} color="#1E40AF" />
              <Text style={styles.rainingNowText}>
                {currentCondition.en} in area · {currentCondition.kn}
              </Text>
            </View>
          )}
        </View>

        {/* Rain-diary bar chart removed per farmer feedback — the
            forecast grid above already covers "how much rain today"
            visually, and the mm bars weren't earning their space. */}

      </ScrollView>

      {/* ── WiFi pair modal ── */}
      <Modal
        visible={wifiModal}
        transparent
        animationType="fade"
        onRequestClose={() => setWifiModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBg}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.modalCard}
            contentContainerStyle={{ paddingBottom: SPACING.md }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalTitle}>
              WiFi for {connectedDeviceLabel ?? 'this sensor'}
            </Text>
            <Text style={styles.modalTitleKn}>ಈ ಸಂವೇದಕಕ್ಕೆ ವೈಫೈ</Text>

            {/* Show which sensor is being configured — for multi-plot farmers,
                this makes it clear this WiFi lives on THIS ESP32 only. Each
                plot's ESP32 has its own WiFi list. */}
            <View style={styles.modalCurrentDevice}>
              <Ionicons name="hardware-chip-outline" size={14} color={COLORS.primaryDark} />
              <Text style={styles.modalCurrentDeviceText}>
                {savedNetworks.length > 0
                  ? `${savedNetworks.length} network${savedNetworks.length > 1 ? 's' : ''} saved on this sensor`
                  : 'This sensor has no WiFi saved yet'}
              </Text>
            </View>

            <Text style={styles.modalHint}>
              Save up to 3 WiFi networks in priority order. The sensor tries #1 first;
              if it fails, falls back to #2, then #3. Great for adding your home
              router as #1 plus phone hotspot as #2.
              {"\n\n"}
              {savedNetworks.length > 0
                ? '⚠ Passwords are hidden for security. Leave a slot\'s password blank to keep the existing one; type a new password to replace it.'
                : ''}
              {"\n\n"}
              Have more plots? Each ESP32 stores its own WiFi. Pair one at a time — tap "+ Add plot" on the Weather tab.
            </Text>

            {wifiNets.map((n, idx) => (
              <View key={idx} style={styles.wifiSlotCard}>
                <View style={styles.wifiSlotHead}>
                  <Text style={styles.wifiSlotBadge}>
                    #{idx + 1} {idx === 0 ? '· Primary' : idx === 1 ? '· Backup' : '· Fallback'}
                  </Text>
                  {wifiNets.length > 1 && (
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => setWifiNets(prev => prev.filter((_, i) => i !== idx))}
                    >
                      <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={styles.modalInput}
                  value={n.ssid}
                  onChangeText={v => setWifiNets(prev => prev.map((x, i) => i === idx ? { ...x, ssid: v } : x))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="WiFi name (SSID)"
                  placeholderTextColor={COLORS.textMuted}
                />
                <TextInput
                  style={[styles.modalInput, { marginTop: 8 }]}
                  value={n.pass}
                  onChangeText={v => setWifiNets(prev => prev.map((x, i) => i === idx ? { ...x, pass: v } : x))}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Password"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            ))}

            {wifiNets.length < MAX_WIFI_NETS && (
              <TouchableOpacity
                style={styles.wifiAddBtn}
                activeOpacity={0.85}
                onPress={() => setWifiNets(prev => [...prev, { ssid: '', pass: '' }])}
              >
                <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                <Text style={styles.wifiAddText}>Add another network</Text>
              </TouchableOpacity>
            )}

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setWifiModal(false)}
                disabled={wifiSaving}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary, wifiSaving && { opacity: 0.6 }]}
                disabled={wifiSaving}
                onPress={async () => {
                  const cleaned = wifiNets
                    .map(n => ({ ssid: n.ssid.trim(), pass: n.pass }))
                    .filter(n => n.ssid.length > 0);

                  const doSave = async () => {
                    setWifiSaving(true);
                    const ok = await writeConfigToEsp({
                      networks: cleaned,
                      url:  API_BASE,
                      farmerId: farmerIdRef.current ?? undefined,
                    });
                    setWifiSaving(false);
                    if (ok) {
                      setWifiModal(false);
                      setWifiNets([{ ssid: '', pass: '' }]);
                      Alert.alert(
                        cleaned.length === 0 ? 'WiFi cleared' : 'Sent to sensor',
                        cleaned.length === 0
                          ? 'All WiFi has been removed from the sensor. It will stay in Bluetooth-only mode until you add a network.'
                          : `${cleaned.length} network${cleaned.length > 1 ? 's' : ''} saved. The ESP32 will try them in priority order.\n\nಒಂದೆರಡು ನಿಮಿಷದೊಳಗೆ ಸಂಪರ್ಕವಾಗಬಹುದು.`,
                      );
                    } else {
                      Alert.alert('Send failed', 'Please stay near the ESP32 and try again.');
                    }
                  };

                  // Guard against accidental full-wipe. If the farmer emptied
                  // every slot but the sensor DOES have saved WiFi right now,
                  // ask to confirm — saving 0 networks kills its cloud path
                  // until they re-pair.
                  if (cleaned.length === 0 && savedNetworks.length > 0) {
                    Alert.alert(
                      'Remove all WiFi?',
                      `${connectedDeviceLabel ?? 'This sensor'} currently has ${savedNetworks.length} saved network${savedNetworks.length > 1 ? 's' : ''}. Saving empty will remove them all and the sensor won't push data to the cloud until you add one back.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove all', style: 'destructive', onPress: doSave },
                      ],
                    );
                    return;
                  }
                  await doSave();
                }}
              >
                <Text style={styles.modalBtnPrimaryText}>
                  {wifiSaving ? 'Sending…' : 'Save to sensor'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Pair-a-new-sensor wizard ── */}
      <Modal
        visible={wizardOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setWizardOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBg}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            {/* Progress dots + close */}
            <View style={styles.wizHead}>
              <View style={styles.wizDots}>
                {(['welcome','scanning','wifi','sending','success'] as WizStep[]).map(s => (
                  <View
                    key={s}
                    style={[
                      styles.wizDot,
                      wizStep === s && styles.wizDotActive,
                      (['welcome','scanning','wifi','sending','success'] as WizStep[]).indexOf(s) <
                        (['welcome','scanning','wifi','sending','success'] as WizStep[]).indexOf(wizStep)
                        && styles.wizDotDone,
                    ]}
                  />
                ))}
              </View>
              <TouchableOpacity
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setWizardOpen(false)}
              >
                <Ionicons name="close" size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {/* ── Step 1: Welcome ── */}
            {wizStep === 'welcome' && (
              <>
                <View style={styles.wizHero}>
                  <MaterialCommunityIcons name="broadcast" size={48} color={COLORS.primary} />
                </View>
                <Text style={styles.wizTitle}>Let's pair your sensor</Text>
                <Text style={styles.wizTitleKn}>ನಿಮ್ಮ ಸಂವೇದಕ ಜೋಡಿಸೋಣ</Text>
                <Text style={styles.wizBody}>
                  Before you start:{"\n"}
                  1. Plug the ESP32 into power.{"\n"}
                  2. Wait ~10 seconds for the LED to start blinking.{"\n"}
                  3. Stand within 3 metres of the sensor.
                  {"\n\n"}
                  This takes about 2 minutes total.
                </Text>
                <TouchableOpacity
                  style={[styles.modalBtnSolo, styles.modalBtnPrimary, { marginTop: 20 }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    setWizStep('scanning');
                    setWizError(null);
                    // Kick off the BLE scan. If it's already connected (rare
                    // during wizard flow but possible), the effect above
                    // immediately advances to 'wifi'.
                    if (bleStatus !== 'connected') {
                      startScan();
                    }
                  }}
                >
                  <Text style={styles.modalBtnPrimaryText}>Start pairing</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ── Step 2: Scanning / connecting ── */}
            {wizStep === 'scanning' && (
              <>
                <View style={styles.wizHero}>
                  {wizError ? (
                    <Ionicons name="alert-circle-outline" size={48} color="#B91C1C" />
                  ) : (
                    // Ring pulses around the BT icon so the step visibly
                    // shows "still working" — a static icon looked frozen.
                    <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ position: 'absolute' }}>
                        <PulsingRing />
                      </View>
                      <Ionicons name="bluetooth" size={36} color={COLORS.accentBlue} />
                    </View>
                  )}
                </View>
                <Text style={styles.wizTitle}>
                  {wizError ? 'Something went wrong' : 'Looking for your sensor…'}
                </Text>
                <Text style={styles.wizTitleKn}>
                  {wizError ? 'ದೋಷ' : 'ಸಂವೇದಕ ಹುಡುಕುತ್ತಿದೆ'}
                </Text>
                <Text style={styles.wizBody}>
                  {wizError ?? "We're scanning nearby for KisanShakti-ESP32. This usually takes 10–20 seconds."}
                </Text>
                {wizError && (
                  <TouchableOpacity
                    style={[styles.modalBtnSolo, styles.modalBtnPrimary, { marginTop: 20 }]}
                    onPress={() => { setWizError(null); startScan(); }}
                  >
                    <Text style={styles.modalBtnPrimaryText}>Try again</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* ── Step 3: WiFi credentials ── */}
            {wizStep === 'wifi' && (
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={styles.wizHero}>
                  <Ionicons name="wifi" size={48} color={COLORS.primary} />
                </View>
                <Text style={styles.wizTitle}>Connect it to WiFi</Text>
                <Text style={styles.wizTitleKn}>ವೈಫೈಗೆ ಸಂಪರ್ಕಿಸಿ</Text>
                <Text style={styles.wizBody}>
                  Add your home WiFi below. You can add up to 3 networks (a backup like your phone hotspot is smart — the sensor will fall back if your router is down).
                  {"\n\n"}
                  ⚠ 2.4 GHz WiFi only. Most home routers work — 5 GHz-only routers don't.
                </Text>

                <Text style={styles.modalLabel}>Nickname this plot (optional)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={wizPlotName}
                  onChangeText={setWizPlotName}
                  placeholder="e.g. Tomato plot"
                  placeholderTextColor={COLORS.textMuted}
                />

                {wizNets.map((n, idx) => (
                  <View key={idx} style={styles.wifiSlotCard}>
                    <View style={styles.wifiSlotHead}>
                      <Text style={styles.wifiSlotBadge}>
                        #{idx + 1} {idx === 0 ? '· Primary' : idx === 1 ? '· Backup' : '· Fallback'}
                      </Text>
                      {wizNets.length > 1 && (
                        <TouchableOpacity
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() => setWizNets(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput
                      style={styles.modalInput}
                      value={n.ssid}
                      onChangeText={v => setWizNets(prev => prev.map((x, i) => i === idx ? { ...x, ssid: v } : x))}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="WiFi name (SSID)"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <TextInput
                      style={[styles.modalInput, { marginTop: 8 }]}
                      value={n.pass}
                      onChangeText={v => setWizNets(prev => prev.map((x, i) => i === idx ? { ...x, pass: v } : x))}
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Password"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                ))}
                {wizNets.length < MAX_WIFI_NETS && (
                  <TouchableOpacity
                    style={styles.wifiAddBtn}
                    activeOpacity={0.85}
                    onPress={() => setWizNets(prev => [...prev, { ssid: '', pass: '' }])}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.wifiAddText}>Add another network</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.modalBtn, styles.modalBtnPrimary,
                    { marginTop: 20 },
                    wizNets.every(n => n.ssid.trim().length === 0) && { opacity: 0.5 },
                  ]}
                  disabled={wizNets.every(n => n.ssid.trim().length === 0)}
                  onPress={async () => {
                    setWizStep('sending');
                    const cleaned = wizNets
                      .map(n => ({ ssid: n.ssid.trim(), pass: n.pass }))
                      .filter(n => n.ssid.length > 0);

                    // Claim the sensor + get a device_token BEFORE we push
                    // WiFi over BLE, so the very first /reading POST from
                    // the ESP32 already carries the token — no race window
                    // where the backend would 401 a pending request.
                    // Best-effort: if the PATCH fails (backend down or the
                    // saved-config snapshot didn't yet deliver device_id),
                    // we still push WiFi so the sensor isn't stranded; the
                    // Success-step effect will retry the token flow.
                    let deviceToken: string | undefined;
                    const dev = connectedDeviceId;
                    if (dev) {
                      try {
                        const patched = await updateSensorDevice(dev, {
                          ...(wizPlotName.trim() ? { label: wizPlotName.trim() } : {}),
                        });
                        if (patched?.device_token) deviceToken = patched.device_token;
                      } catch (_) { /* keep going without token */ }
                    }

                    const ok = await writeConfigToEsp({
                      networks:    cleaned,
                      url:         API_BASE,
                      farmerId:    farmerIdRef.current ?? undefined,
                      deviceToken,
                    });
                    if (ok) {
                      setWizStep('success');
                    } else {
                      setWizError('Send failed — please stay near the sensor and try again.');
                      setWizStep('wifi');
                    }
                  }}
                >
                  <Text style={styles.modalBtnPrimaryText}>Save & connect</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* ── Step 4: Sending ── */}
            {wizStep === 'sending' && (
              <>
                <View style={styles.wizHero}>
                  <Ionicons name="cloud-upload-outline" size={48} color={COLORS.accentBlue} />
                </View>
                <Text style={styles.wizTitle}>Sending to sensor…</Text>
                <Text style={styles.wizTitleKn}>ಸಂವೇದಕಕ್ಕೆ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…</Text>
                <Text style={styles.wizBody}>Just a moment.</Text>
              </>
            )}

            {/* ── Step 5: Success ── */}
            {wizStep === 'success' && (() => {
              // Confirmed = the cloud has seen a fresh reading (<3 min) OR
              // we're getting BLE data right now. Until then, "Sensor paired"
              // is only "config sent" — we can't promise the ESP32 got on WiFi.
              const cloudFresh = cloudAgeSec != null && cloudAgeSec < 180;
              const bleFresh   = bleStatus === 'connected' && sensorData != null;
              const confirmed  = cloudFresh || bleFresh;
              return (
                <>
                  <View style={[styles.wizHero, { backgroundColor: confirmed ? '#DCFCE7' : '#EFF6FF' }]}>
                    {confirmed ? (
                      <Ionicons name="checkmark-circle" size={56} color={COLORS.primary} />
                    ) : (
                      <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ position: 'absolute' }}>
                          <PulsingRing />
                        </View>
                        <Ionicons name="cloud-upload-outline" size={36} color={COLORS.accentBlue} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.wizTitle}>
                    {confirmed ? 'Sensor is live! 🎉' : 'Config sent — waiting for first reading…'}
                  </Text>
                  <Text style={styles.wizTitleKn}>
                    {confirmed ? 'ಸಂವೇದಕ ಸಿದ್ಧ!' : 'ಮೊದಲ ಓದುವಿಕೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ…'}
                  </Text>
                  <Text style={styles.wizBody}>
                    {confirmed
                      ? "Data is flowing. You'll see readings on the Weather tab even from off-site."
                      : "Your ESP32 is trying to join the WiFi you saved. First cloud reading usually arrives in 1–2 minutes. You can close this and check the Weather tab."}
                    {"\n\n"}
                    Change WiFi any time via the "WiFi" button on this screen.
                  </Text>
                  <TouchableOpacity
                    style={[styles.modalBtnSolo, styles.modalBtnPrimary, { marginTop: 20 }]}
                    onPress={() => setWizardOpen(false)}
                  >
                    <Text style={styles.modalBtnPrimaryText}>
                      {confirmed ? 'Done' : 'Close and wait'}
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Small sub-components ─────────────────────────────────────────────────────

function SensorCell({
  iconName, iconColor, en, kn, value, sub, fillPct, fillColor,
}: {
  iconName: any; iconColor: string;
  en: string; kn: string;
  value: string; sub: string;
  fillPct: number; fillColor: string;
}) {
  const pct = Math.max(0, Math.min(100, fillPct || 0));
  return (
    <View style={styles.sensorCard}>
      <View style={styles.sensorTop}>
        <Ionicons name={iconName} size={20} color={iconColor} />
        <Text style={styles.sensorLabel}>{t(en, kn)}</Text>
      </View>
      <Text style={styles.sensorValue}>{value}</Text>
      <Text style={styles.sensorSub}>{sub}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: fillColor }]} />
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 120 },

  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACING.lg, gap: 12 },
  title:    { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  titleKn:  { fontSize: 14, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },

  // Irrigation card
  advisoryCard: {
    backgroundColor: '#DBEAFE', borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: '#BFDBFE',
    flexDirection: 'row', gap: 14, marginBottom: SPACING.md,
    overflow: 'hidden', position: 'relative',
    ...SHADOWS.card,
  },
  advisoryCardLow: {
    backgroundColor: '#DCFCE7', borderColor: '#BBF7D0',
  },
  advisoryHeader:   { fontSize: 11, color: COLORS.primary, fontWeight: '700' },
  advisoryTitle:    { fontSize: 16, fontWeight: '800', color: COLORS.primaryDark, marginTop: 4 },
  advisoryTitleKn:  { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark, marginTop: 1 },
  advisoryMsg:      { fontSize: 12, color: COLORS.textBody, marginTop: 4, lineHeight: 16 },
  advisoryMsgKn:    { fontSize: 12, color: COLORS.textBody, marginTop: 1, lineHeight: 16 },

  // Fungal + Spray row
  advisoryRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.xl },
  miniAdvisory: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  miniAdvisoryDanger: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
  miniAdvisoryWarn:   { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  miniAdvisoryOk:     { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  miniAdvisoryTop:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  miniAdvisoryHead:   { fontSize: 10, color: COLORS.textMuted, fontWeight: '700' },
  miniAdvisoryTitle:  { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  miniAdvisoryTitleKn:{ fontSize: 12, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  miniAdvisoryMsg:    { fontSize: 11, color: COLORS.textBody, marginTop: 4, lineHeight: 14 },

  // Section headers
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md, gap: 8 },
  sectionTitle:  { fontSize: 15, fontWeight: '700', color: COLORS.textDark, lineHeight: 20 },
  fieldTag:      { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', lineHeight: 14, textAlign: 'right' },

  // Sensor grid
  sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACING.xl },
  sensorCard: {
    width: (width - SPACING.xl * 2 - 10) / 2,
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  sensorTop:     { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 8, minHeight: 34 },
  sensorLabel:   { fontSize: 11, color: COLORS.textMuted, fontWeight: '600', lineHeight: 15, flex: 1 },
  sensorValue:   { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  sensorSub:     { fontSize: 10, color: COLORS.textMuted, marginTop: 2, marginBottom: 8 },
  progressTrack: { height: 4, backgroundColor: '#F3F4F6', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 2 },

  // Forecast
  forecastCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  forecastRainRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 },
  forecastRainText:     { fontSize: 12, fontWeight: '700', color: COLORS.primaryDark },
  forecastRainTextKn:   { fontSize: 11, fontWeight: '600', color: COLORS.textBody, marginTop: 1 },
  forecastLoading:      { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 20 },
  forecastGrid:         { flexDirection: 'row', justifyContent: 'space-between' },
  forecastItem:         { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, borderRadius: RADII.md },
  forecastItemToday:    { backgroundColor: '#E8F5E9' },
  forecastDay:          { fontSize: 11, color: COLORS.textMuted, fontWeight: '700' },
  forecastDayKn:        { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', marginTop: 1 },
  forecastDayToday:     { color: COLORS.primaryDark, fontWeight: '800' },
  forecastIconWrap:     { marginVertical: 6, height: 34, alignItems: 'center', justifyContent: 'center' },
  forecastHigh:         { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  forecastLow:          { fontSize: 10, color: COLORS.textMuted },
  forecastPct:          { fontSize: 10, color: COLORS.primary, fontWeight: '700', marginTop: 4 },
  rainingNowBanner:     {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 12, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: '#DBEAFE', borderRadius: RADII.md,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  rainingNowText:       { fontSize: 12, fontWeight: '700', color: '#1E40AF' },
  rainingNowSub:        { fontSize: 10, color: '#3B4E78', marginTop: 2 },

  // BT-off card — clean, professional, with a distinct CTA button
  btOffCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADII.lg,
    padding: SPACING.md,
    borderLeftWidth: 4, borderLeftColor: '#F59E0B',
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: COLORS.border, borderRightColor: COLORS.border, borderBottomColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: SPACING.md,
    ...SHADOWS.card,
  },
  btOffLeft: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  btOffIconRing: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F59E0B',
    alignItems: 'center', justifyContent: 'center',
  },
  btOffTitle:   { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  btOffTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  btOffMsg:     { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },
  btOffCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADII.pill,
  },
  btOffCtaText: { fontSize: 12, fontWeight: '700', color: COLORS.bgCard },

  // Stale cloud reading card — amber, less alarming than an error but visible
  staleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEF3C7', borderColor: '#FDE68A', borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  staleTitle: { fontSize: 12, fontWeight: '700', color: '#78350F' },
  staleMsg:   { fontSize: 10, color: '#92400E', marginTop: 1 },

  // Compact offline pill — shown whenever we're serving stale cached data
  offlineCard: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7', borderColor: '#FDE68A', borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADII.pill,
    marginBottom: SPACING.md,
  },
  offlineText: { fontSize: 11, fontWeight: '700', color: '#78350F' },

  // GPS-fallback banner — tap opens system Location settings
  gpsFallbackCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEF3C7', borderColor: '#FDE68A', borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  gpsFallbackTitle: { fontSize: 12, fontWeight: '700', color: '#78350F' },
  gpsFallbackMsg:   { fontSize: 10, color: '#92400E', marginTop: 1 },

  // "Connect your ESP32" hero card — shown until any sensor data lands
  noSensorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE', borderWidth: 1,
    borderRadius: RADII.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.card,
  },
  noSensorIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#DBEAFE',
    alignItems: 'center', justifyContent: 'center',
  },
  noSensorTitle:   { fontSize: 13, fontWeight: '800', color: COLORS.primaryDark },
  noSensorTitleKn: { fontSize: 11, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  noSensorMsg:     { fontSize: 10, color: COLORS.textMuted, marginTop: 4, lineHeight: 14 },
  noSensorCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADII.pill,
  },
  noSensorCtaText: { fontSize: 12, fontWeight: '800', color: COLORS.bgCard },

  // Low-battery card — red, more urgent than the stale-cloud amber
  lowBattCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  lowBattTitle: { fontSize: 12, fontWeight: '800', color: '#7F1D1D' },
  lowBattMsg:   { fontSize: 10, color: '#991B1B', marginTop: 1, lineHeight: 13 },

  // Setup WiFi CTA (shown only while BLE is connected)
  setupWifiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#DBEAFE', borderColor: '#BFDBFE', borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADII.pill,
    marginBottom: SPACING.md,
  },
  setupWifiText: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },

  // WiFi pair modal
  modalBg: {
    flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center', alignItems: 'center', padding: SPACING.xl,
  },
  modalCard: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.xl,
    ...SHADOWS.card,
  },
  wifiSlotCard: {
    marginTop: 14,
    padding: 10,
    borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: '#F9FAFB',
  },
  wifiSlotHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  wifiSlotBadge: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark },
  wifiAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 6,
  },
  wifiAddText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },

  // "Editing N saved networks" pill at the top of the WiFi modal so the
  // farmer can immediately see there IS pre-existing state — otherwise
  // the blank form looks like "no networks are saved" which is wrong.
  modalCurrentDevice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADII.pill,
    backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1,
  },
  modalCurrentDeviceText: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },

  // Chip-vs-BLE mismatch card — amber warning
  mismatchCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderColor: '#FDE68A', borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  mismatchText: { flex: 1, fontSize: 11, fontWeight: '700', color: '#78350F', lineHeight: 15 },

  // Pair-a-new-sensor wizard
  wizHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  wizDots: { flexDirection: 'row', gap: 6, flex: 1 },
  wizDot: {
    width: 24, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB',
  },
  wizDotActive: { backgroundColor: COLORS.primary },
  wizDotDone:   { backgroundColor: COLORS.primaryDark },
  wizHero: {
    alignSelf: 'center',
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, marginTop: 4,
  },
  wizTitle:   { fontSize: 18, fontWeight: '800', color: COLORS.textDark, textAlign: 'center' },
  wizTitleKn: { fontSize: 13, fontWeight: '700', color: COLORS.textBody, textAlign: 'center', marginTop: 2 },
  wizBody:    { fontSize: 12, color: COLORS.textBody, textAlign: 'center', marginTop: 10, lineHeight: 17 },

  // Device-switcher chip strip
  deviceChipRow: {
    flexDirection: 'row', gap: 8,
    paddingBottom: SPACING.md,
  },
  deviceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1, borderColor: COLORS.border,
    maxWidth: 200,
  },
  deviceChipActive: {
    backgroundColor: '#DBEAFE',
    borderColor: COLORS.primary,
  },
  deviceChipDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#94A3B8',
  },
  deviceChipText:       { fontSize: 12, fontWeight: '700', color: COLORS.textBody },
  deviceChipTextActive: { color: COLORS.primaryDark },
  deviceChipAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.primary,
    // No maxWidth — some Android builds clipped the label when this shared
    // the base deviceChip cap. Explicit sizing keeps "Add plot" visible.
  },
  deviceChipAddText: {
    fontSize: 12, fontWeight: '800',
    color: COLORS.bgCard,
  },

  // Rain diary bar chart
  rainDiaryCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    marginTop: SPACING.sm, marginBottom: SPACING.xl,
    ...SHADOWS.card,
  },
  rainDiaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    height: 110,
  },
  rainDiaryBarCell: {
    flex: 1, alignItems: 'center', justifyContent: 'flex-end',
    paddingHorizontal: 1,
  },
  rainDiaryBarTrack: {
    width: '70%', height: 60,
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  rainDiaryBarFill: {
    width: '100%',
    borderTopLeftRadius: 3, borderTopRightRadius: 3,
  },
  rainDiaryBarPast:   { backgroundColor: '#2563EB' },
  rainDiaryBarToday:  { backgroundColor: COLORS.primary },
  rainDiaryBarFuture: {
    backgroundColor: 'transparent',
    borderWidth: 1.5, borderColor: '#93C5FD',
    borderBottomWidth: 0,
  },
  rainDiaryMm:        { fontSize: 9, fontWeight: '700', color: COLORS.textBody, height: 12 },
  rainDiaryLabel:     { fontSize: 9, color: COLORS.textMuted, fontWeight: '600' },
  rainDiaryLabelToday:{ color: COLORS.primaryDark, fontWeight: '800' },

  // Crop-stage pill on the Irrigation Advisory card header
  advisoryHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, flexWrap: 'wrap',
  },
  cropStagePill: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: RADII.pill,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  cropStagePillText: { fontSize: 10, fontWeight: '800', color: COLORS.primaryDark },
  modalTitle:   { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  modalTitleKn: { fontSize: 13, fontWeight: '700', color: COLORS.textBody, marginTop: 2 },
  modalHint:    { fontSize: 11, color: COLORS.textMuted, marginTop: 8, lineHeight: 15 },
  modalLabel:   { fontSize: 11, fontWeight: '700', color: COLORS.textBody, marginTop: 14, marginBottom: 4 },
  modalInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, color: COLORS.textDark,
    backgroundColor: '#F9FAFB',
  },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtn: {
    flex: 1, paddingVertical: 12, borderRadius: RADII.md,
    alignItems: 'center', justifyContent: 'center',
  },
  // Solo variant — no flex:1, so the text stays visible when the button
  // isn't sharing a row with siblings. Wizard steps use this.
  modalBtnSolo: {
    alignSelf: 'stretch',
    paddingVertical: 14, paddingHorizontal: 20,
    borderRadius: RADII.md,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 48,
  },
  modalBtnGhost:      { backgroundColor: '#F1F5F9' },
  modalBtnGhostText:  { fontSize: 13, fontWeight: '700', color: COLORS.textBody },
  modalBtnPrimary:    { backgroundColor: COLORS.primary },
  modalBtnPrimaryText:{ fontSize: 13, fontWeight: '800', color: COLORS.bgCard },
});
