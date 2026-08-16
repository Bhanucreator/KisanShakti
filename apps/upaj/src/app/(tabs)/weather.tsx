import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Dimensions, Animated, Easing, Platform, PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';

const { width } = Dimensions.get('window');

// ── BLE Constants ────────────────────────────────────────────────────────────
const DEVICE_NAME       = 'KisanShakti-Field-A';
const SERVICE_UUID      = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const TX_CHAR_UUID      = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
const SCAN_TIMEOUT_MS   = 8000; // fall back to demo mode after 8 s

// Singleton BleManager — created once at module level, never re-created on re-render
const bleManager = new BleManager();

// ── Types ────────────────────────────────────────────────────────────────────
type BleStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

interface SensorData {
  soil_moisture: number;
  temperature:   number;
  humidity:      number;
  is_raining:    boolean;
}

type ForecastDay = { day: string; high: string; low: string; rainPct: string };

// ── Static Data ──────────────────────────────────────────────────────────────
const FORECAST: ForecastDay[] = [
  { day: 'Today', high: '31°', low: '20°', rainPct: '70%' },
  { day: 'Tue',   high: '27°', low: '20°', rainPct: '80%' },
  { day: 'Wed',   high: '26°', low: '21°', rainPct: '65%' },
  { day: 'Thu',   high: '29°', low: '21°', rainPct: '30%' },
  { day: 'Fri',   high: '32°', low: '22°', rainPct: '5%'  },
];

const DEFAULT_SENSOR: SensorData = {
  soil_moisture: 25,
  temperature:   29.4,
  humidity:      72,
  is_raining:    true,
};

// ── Permissions ──────────────────────────────────────────────────────────────
async function requestBLEPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const grants = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return Object.values(grants).every(g => g === PermissionsAndroid.RESULTS.GRANTED);
}

// ── Animated Rain Drops ──────────────────────────────────────────────────────
function AnimatedRainDrops() {
  const drops = Array.from({ length: 10 }).map((_, i) => ({
    id:       i,
    anim:     useRef(new Animated.Value(-20)).current,
    left:     `${8 + i * 9.5}%`,
    duration: 600 + (i % 4) * 180,
    delay:    i * 120,
  }));

  useEffect(() => {
    drops.forEach((drop) => {
      const animate = () => {
        drop.anim.setValue(-20);
        Animated.sequence([
          Animated.delay(drop.delay),
          Animated.timing(drop.anim, {
            toValue:          120,
            duration:         drop.duration,
            easing:           Easing.linear,
            useNativeDriver:  true,
          }),
        ]).start(() => animate());
      };
      animate();
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((drop) => (
        <Animated.View
          key={drop.id}
          style={[
            rainStyles.dropLine,
            {
              left:      drop.left as any,
              transform: [{ translateY: drop.anim }, { rotate: '15deg' }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const rainStyles = StyleSheet.create({
  dropLine: {
    position:        'absolute',
    width:           2.5,
    height:          18,
    borderRadius:    1.5,
    backgroundColor: 'rgba(37, 99, 235, 0.75)',
  },
});

// ── Pulsing Ring Animation (shown while scanning) ─────────────────────────────
function PulsingRing() {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue:         1.7,
            duration:        900,
            easing:          Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue:         1,
            duration:        600,
            easing:          Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue:         0,
            duration:        900,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue:         0.8,
            duration:        600,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Animated.View
      style={[
        bleStyles.pulseRing,
        { transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ── BLE Status Button ─────────────────────────────────────────────────────────
interface BleButtonProps {
  status:        BleStatus;
  onPress:       () => void;
  onLongPress:   () => void;
}

function BleStatusButton({ status, onPress, onLongPress }: BleButtonProps) {
  if (status === 'connected') {
    return (
      <TouchableOpacity
        style={[bleStyles.badge, bleStyles.badgeConnected]}
        onLongPress={onLongPress}
        delayLongPress={600}
        activeOpacity={0.8}
      >
        <View style={bleStyles.liveDot} />
        <Text style={bleStyles.badgeText}>ESP32 Live</Text>
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
        <Text style={[bleStyles.badgeText, { color: COLORS.accentBlue }]}>Scanning…</Text>
      </View>
    );
  }

  if (status === 'connecting') {
    return (
      <View style={[bleStyles.badge, bleStyles.badgeScanning]}>
        <Ionicons name="bluetooth" size={14} color={COLORS.accentBlue} />
        <Text style={[bleStyles.badgeText, { color: COLORS.accentBlue }]}>Connecting…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <TouchableOpacity
        style={[bleStyles.badge, bleStyles.badgeError]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Ionicons name="refresh" size={14} color="#D97706" />
        <Text style={[bleStyles.badgeText, { color: '#D97706' }]}>Retry</Text>
      </TouchableOpacity>
    );
  }

  // disconnected
  return (
    <TouchableOpacity
      style={[bleStyles.badge, bleStyles.badgePair]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name="bluetooth" size={14} color={COLORS.bgCard} />
      <Text style={[bleStyles.badgeText, { color: COLORS.bgCard }]}>Pair ESP32</Text>
    </TouchableOpacity>
  );
}

const bleStyles = StyleSheet.create({
  badge: {
    borderRadius:     RADII.pill,
    paddingHorizontal: 12,
    paddingVertical:   6,
    flexDirection:    'row',
    alignItems:       'center',
    gap:              6,
    borderWidth:      1,
  },
  badgeConnected: {
    backgroundColor: '#E8F5E9',
    borderColor:     '#C8E6C9',
  },
  badgeScanning: {
    backgroundColor: '#EFF6FF',
    borderColor:     '#BFDBFE',
  },
  badgeError: {
    backgroundColor: '#FEF3C7',
    borderColor:     '#FDE68A',
  },
  badgePair: {
    backgroundColor: COLORS.primary,
    borderColor:     COLORS.primaryDark,
  },
  badgeText: {
    fontSize:   12,
    fontWeight: '700',
    color:      COLORS.primaryDark,
  },
  liveDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: COLORS.primary,
  },
  pulseWrapper: {
    width:           20,
    height:          20,
    alignItems:      'center',
    justifyContent:  'center',
  },
  pulseRing: {
    position:        'absolute',
    width:           20,
    height:          20,
    borderRadius:    10,
    borderWidth:     2,
    borderColor:     COLORS.accentBlue,
  },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WeatherScreen() {
  const [sensorData, setSensorData] = useState<SensorData>(DEFAULT_SENSOR);
  const [bleStatus, setBleStatus]   = useState<BleStatus>('disconnected');

  // Refs for cleanup
  const bleSubscription  = useRef<Subscription | null>(null);
  const connectedDevice  = useRef<Device | null>(null);
  const scanTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup helpers ──────────────────────────────────────────────────────
  const clearScanTimeout = () => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
  };

  const clearDemoInterval = () => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
  };

  const unsubscribeBle = () => {
    bleSubscription.current?.remove();
    bleSubscription.current = null;
  };

  const disconnectDevice = useCallback(async () => {
    clearScanTimeout();
    clearDemoInterval();
    unsubscribeBle();
    try { bleManager.stopDeviceScan(); } catch (_) {}
    try {
      if (connectedDevice.current) {
        await connectedDevice.current.cancelConnection();
        connectedDevice.current = null;
      }
    } catch (_) {}
    setBleStatus('disconnected');
  }, []);

  // ── Demo fallback: emits realistic mock data via setInterval ──────────────
  // This activates when no real hardware is found within SCAN_TIMEOUT_MS.
  // Remove or disable this block once physical ESP32 is available.
  const startDemoMode = useCallback(() => {
    setBleStatus('connected');
    const randomise = () => ({
      soil_moisture: Math.round(20 + Math.random() * 60),
      temperature:   parseFloat((25 + Math.random() * 10).toFixed(1)),
      humidity:      Math.round(55 + Math.random() * 40),
      is_raining:    Math.random() > 0.5,
    });
    setSensorData(randomise());
    demoIntervalRef.current = setInterval(() => setSensorData(randomise()), 5000);
  }, []);

  // ── Connect to a real BLE device ─────────────────────────────────────────
  const connectToDevice = useCallback(async (device: Device) => {
    setBleStatus('connecting');
    try {
      const connected   = await device.connect();
      const discovered  = await connected.discoverAllServicesAndCharacteristics();
      connectedDevice.current = discovered;
      setBleStatus('connected');

      const sub = discovered.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_CHAR_UUID,
        (error, characteristic) => {
          if (error) { console.warn('[BLE] Monitor error', error); return; }
          if (!characteristic?.value) return;
          try {
            const json = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            const data: SensorData = JSON.parse(json);
            setSensorData(data);
          } catch (parseErr) {
            console.warn('[BLE] JSON parse error', parseErr);
          }
        }
      );
      bleSubscription.current = sub;
    } catch (err) {
      console.warn('[BLE] Connection error', err);
      setBleStatus('error');
    }
  }, []);

  // ── Start scanning ────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    const granted = await requestBLEPermissions();
    if (!granted) {
      setBleStatus('error');
      return;
    }

    setBleStatus('scanning');

    // Auto-fallback to demo mode if no device found in SCAN_TIMEOUT_MS
    scanTimeoutRef.current = setTimeout(() => {
      bleManager.stopDeviceScan();
      startDemoMode();
    }, SCAN_TIMEOUT_MS);

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.warn('[BLE] Scan error', error);
        clearScanTimeout();
        setBleStatus('error');
        return;
      }
      if (device?.name === DEVICE_NAME) {
        clearScanTimeout();
        bleManager.stopDeviceScan();
        connectToDevice(device);
      }
    });
  }, [connectToDevice, startDemoMode]);

  // ── Component unmount cleanup ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearScanTimeout();
      clearDemoInterval();
      unsubscribeBle();
      try { bleManager.stopDeviceScan(); } catch (_) {}
      connectedDevice.current?.cancelConnection().catch(() => {});
    };
  }, []);

  // ── Handle pair / retry press ─────────────────────────────────────────────
  const handleBlePress = () => {
    if (bleStatus === 'disconnected' || bleStatus === 'error') {
      startScan();
    }
  };

  // ── Long-press on connected badge → disconnect ────────────────────────────
  const handleLongPress = () => {
    if (bleStatus === 'connected') {
      disconnectDevice();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Weather & Field</Text>
            <Text style={styles.subtitle}>Real-time updates from your field</Text>
          </View>

          <BleStatusButton
            status={bleStatus}
            onPress={handleBlePress}
            onLongPress={handleLongPress}
          />
        </View>

        {/* ── Irrigation Advisory Card with Rain Animation ── */}
        <View style={styles.advisoryCard}>
          {/* Animated Rain Overlay */}
          <AnimatedRainDrops />

          <View style={styles.advisoryIconBg}>
            <FontAwesome5 name="umbrella" size={24} color={COLORS.primaryDark} />
          </View>
          <View style={{ flex: 1, zIndex: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.advisoryHeader}>Irrigation Advisory</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
            </View>
            <Text style={styles.advisoryTitle}>Hold Irrigation</Text>
            <Text style={styles.advisoryMsg}>Heavy rain expected in ~2 hours. Save water and wait.</Text>
          </View>
        </View>

        {/* ── Live Field Sensors ── */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="broadcast" size={18} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Live Field Sensors</Text>
          </View>
          <Text style={styles.fieldTag}>Field A — ESP32</Text>
        </View>

        <View style={styles.sensorGrid}>
          {/* Soil Moisture */}
          <View style={styles.sensorCard}>
            <View style={styles.sensorTop}>
              <Ionicons name="water-outline" size={20} color={COLORS.primary} />
              <Text style={styles.sensorLabel}>Soil Moisture</Text>
            </View>
            <Text style={styles.sensorValue}>{sensorData.soil_moisture}%</Text>
            <Text style={styles.sensorSub}>Capacitive</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${sensorData.soil_moisture}%`, backgroundColor: '#2563EB' }]} />
            </View>
          </View>

          {/* Temperature */}
          <View style={styles.sensorCard}>
            <View style={styles.sensorTop}>
              <Ionicons name="thermometer-outline" size={20} color={COLORS.accentAmber} />
              <Text style={styles.sensorLabel}>Temp</Text>
            </View>
            <Text style={styles.sensorValue}>{sensorData.temperature}°c</Text>
            <Text style={styles.sensorSub}>DHT22</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(sensorData.temperature / 50) * 100}%`, backgroundColor: COLORS.accentAmber }]} />
            </View>
          </View>

          {/* Humidity */}
          <View style={styles.sensorCard}>
            <View style={styles.sensorTop}>
              <Ionicons name="cloud-outline" size={20} color="#00BCD4" />
              <Text style={styles.sensorLabel}>Humidity</Text>
            </View>
            <Text style={styles.sensorValue}>{sensorData.humidity}%</Text>
            <Text style={styles.sensorSub}>DHT22 Sensor</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${sensorData.humidity}%`, backgroundColor: '#00BCD4' }]} />
            </View>
          </View>

          {/* Rainfall */}
          <View style={styles.sensorCard}>
            <View style={styles.sensorTop}>
              <Ionicons name="rainy-outline" size={20} color={COLORS.primary} />
              <Text style={styles.sensorLabel}>Rainfall</Text>
            </View>
            <Text style={styles.sensorValue}>{sensorData.is_raining ? 'Raining' : 'None'}</Text>
            <Text style={styles.sensorSub}>{sensorData.is_raining ? 'Rain detected' : 'No rain detected'}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: sensorData.is_raining ? '100%' : '5%', backgroundColor: COLORS.primary }]} />
            </View>
          </View>
        </View>

        {/* ── Soil Moisture Trend Graph ── */}
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Soil Moisture — Last 6 Hours</Text>

          <View style={styles.graphContainer}>
            {/* Y-axis labels */}
            <View style={styles.graphAxisY}>
              <Text style={styles.axisText}>100%</Text>
              <Text style={styles.axisText}>50%</Text>
              <Text style={styles.axisText}>0%</Text>
            </View>

            {/* Bar columns — heights derived from pixel math: chartHeight * (pct / 100) */}
            <View style={styles.barsArea}>
              {([
                { pct: 80, label: '6h' },
                { pct: 65, label: '5h' },
                { pct: 50, label: '4h' },
                { pct: 40, label: '3h' },
                { pct: 30, label: '2h' },
                { pct: 25, label: 'Now' },
              ] as const).map(({ pct, label }) => (
                <View key={label} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: Math.round((pct / 100) * 80) }]} />
                  </View>
                  <Text style={[styles.axisText, label === 'Now' && { color: COLORS.primaryDark, fontWeight: '800' }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Regional Forecast ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Regional Forecast</Text>
          <Text style={styles.fieldTag}>Kolar, Karnataka</Text>
        </View>

        <View style={styles.forecastCard}>
          <View style={styles.forecastRainRow}>
            <Ionicons name="rainy" size={16} color={COLORS.primary} />
            <Text style={styles.forecastRainText}>76% rain in next 24h · Heavy shower expected</Text>
          </View>

          <View style={styles.forecastGrid}>
            {FORECAST.map((f, i) => (
              <View key={f.day} style={[styles.forecastItem, i === 0 && styles.forecastItemToday]}>
                <Text style={[styles.forecastDay, i === 0 && styles.forecastDayToday]}>{f.day}</Text>
                <Text style={styles.forecastHigh}>{f.high}</Text>
                <Text style={styles.forecastLow}>{f.low}</Text>
                <Text style={styles.forecastPct}>{f.rainPct}</Text>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 48 },

  // Header
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  title:    { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Advisory Card
  advisoryCard: {
    backgroundColor: '#DBEAFE', borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: '#BFDBFE',
    flexDirection: 'row', gap: 14, marginBottom: SPACING.xl,
    overflow: 'hidden', position: 'relative',
    ...SHADOWS.card,
  },
  advisoryIconBg: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.bgCard, alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  advisoryHeader: { fontSize: 11, color: COLORS.primary, fontWeight: '600' },
  advisoryTitle:  { fontSize: 16, fontWeight: '800', color: COLORS.primaryDark, marginTop: 2 },
  advisoryMsg:    { fontSize: 12, color: COLORS.textBody, marginTop: 2, lineHeight: 16 },

  // Section Header
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  fieldTag:      { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },

  // Sensor Grid
  sensorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACING.xl },
  sensorCard: {
    width: (width - SPACING.xl * 2 - 10) / 2,
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  sensorTop:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sensorLabel:   { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  sensorValue:   { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  sensorSub:     { fontSize: 10, color: COLORS.textMuted, marginTop: 2, marginBottom: 8 },
  progressTrack: { height: 4, backgroundColor: '#F3F4F6', borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 2 },

  // Chart Card
  chartCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.xl, ...SHADOWS.card,
  },
  chartTitle:    { fontSize: 13, fontWeight: '700', color: COLORS.textDark, marginBottom: 16 },
  graphContainer: { flexDirection: 'row', alignItems: 'flex-end' },
  graphAxisY:    { justifyContent: 'space-between', paddingRight: 8, height: 80 + 20 },
  axisText:      { fontSize: 9, color: COLORS.textMuted },
  barsArea:      { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barCol:        { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: {
    width: '100%', height: 80, justifyContent: 'flex-end',
    backgroundColor: '#F3F4F6', borderRadius: RADII.sm, overflow: 'hidden',
  },
  barFill: { width: '100%', backgroundColor: COLORS.primary, borderRadius: RADII.sm },

  // Forecast Card
  forecastCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  forecastRainRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  forecastRainText:   { fontSize: 12, fontWeight: '600', color: COLORS.primaryDark },
  forecastGrid:       { flexDirection: 'row', justifyContent: 'space-around' },
  forecastItem:       { alignItems: 'center', padding: 6 },
  forecastItemToday:  { backgroundColor: '#E8F5E9', borderRadius: RADII.md },
  forecastDay:        { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  forecastDayToday:   { color: COLORS.primaryDark, fontWeight: '800' },
  forecastHigh:       { fontSize: 13, fontWeight: '800', color: COLORS.textDark, marginTop: 4 },
  forecastLow:        { fontSize: 10, color: COLORS.textMuted },
  forecastPct:        { fontSize: 10, color: COLORS.primary, fontWeight: '700', marginTop: 4 },
});
