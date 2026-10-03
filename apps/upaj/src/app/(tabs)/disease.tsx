import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, ImageBackground, Alert,
  ActivityIndicator, Animated, Easing, Dimensions, Modal, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { SafeGradient as LinearGradient } from '../../components/safe-gradient';

// Lazy-load expo-image-picker — may be missing from older APKs
let ImagePicker: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ImagePicker = require('expo-image-picker');
} catch {
  ImagePicker = null;
}
import { Ionicons, MaterialCommunityIcons, FontAwesome5, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDiseaseDetection, InferenceResult, recordScanFeedback, getLastLoadError } from '../../hooks/use-disease-detection';

// expo-file-system is optional — try/catch so older APKs without it still run.
// We use it to copy the scanned photo into the app's documents directory so
// the "last diagnosis" survives the OS clearing the camera cache on restart.
//
// IMPORTANT: import the legacy subpath. In Expo SDK 54+ the top-level module
// switched to a new File/Directory class API and the function-style methods
// (getInfoAsync, copyAsync, deleteAsync, documentDirectory) are deprecated
// there — calling them throws instead of just warning, which was silently
// wiping our restored diagnosis on every boot. The legacy subpath keeps the
// old function API alive and stable.
let FileSystem: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FileSystem = require('expo-file-system/legacy');
} catch {
  // Fall back to the top-level import if the legacy subpath isn't shipped
  // in an older SDK. The deprecated warning is preferable to no persistence.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    FileSystem = require('expo-file-system');
  } catch { FileSystem = null; }
}

// ── Persistence for last diagnosis ───────────────────────────────────────────
// The farmer scans a leaf, then closes the app and comes back later — the
// scan card should still be there. Camera/gallery URIs live in the OS cache,
// which gets purged, so we (a) copy the photo into documentDirectory and
// (b) store the metadata blob in AsyncStorage. On mount we read it back and
// hydrate state before render, so the card shows immediately.
const LAST_SCAN_KEY = 'disease:last_scan_v1';

type PersistedScan = {
  uri:        string;       // absolute path to the copied image on disk
  diagnosis:  InferenceResult;
  at:         string;       // ISO timestamp of the scan
};

async function saveLastScan(uri: string, diagnosis: InferenceResult): Promise<PersistedScan | null> {
  try {
    let durableUri = uri;
    // Prefer a durable copy in documents dir. Fall back to the original URI
    // if expo-file-system isn't available — the diagnosis text still restores
    // correctly, only the image may become blank later.
    //
    // IMPORTANT: use a UNIQUE filename per scan (timestamp suffix). If we
    // always wrote to "last_scan.jpg", the file bytes would change but the
    // URI string stays byte-identical → React Native's <Image> in-memory
    // decoder cache keeps serving the OLD bitmap while the diagnosis JSON
    // shows the new disease/confidence. Unique filenames give <Image> a
    // fresh source and force a re-decode.
    if (FileSystem?.documentDirectory && FileSystem?.copyAsync) {
      const dest = `${FileSystem.documentDirectory}scan_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      durableUri = dest;

      // Delete the previous scan file so we don't leak storage.
      // Read what was saved before we overwrite AsyncStorage below.
      try {
        const prevRaw = await AsyncStorage.getItem(LAST_SCAN_KEY);
        if (prevRaw) {
          const prev = JSON.parse(prevRaw) as PersistedScan;
          if (prev.uri && prev.uri !== dest
              && prev.uri.startsWith(FileSystem.documentDirectory)) {
            await FileSystem.deleteAsync(prev.uri, { idempotent: true });
          }
        }
      } catch { /* best-effort cleanup — never block a save on it */ }
    }
    const record: PersistedScan = { uri: durableUri, diagnosis, at: new Date().toISOString() };
    await AsyncStorage.setItem(LAST_SCAN_KEY, JSON.stringify(record));
    return record;
  } catch (e) {
    console.warn('[Disease] persist last scan failed:', e);
    return null;
  }
}

async function loadLastScan(): Promise<PersistedScan | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SCAN_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as PersistedScan;
    // Sanity check: image file still there? If not, keep the diagnosis text
    // but blank the URI so the Image component doesn't error.
    if (FileSystem?.getInfoAsync && rec.uri?.startsWith(FileSystem.documentDirectory ?? '')) {
      const info = await FileSystem.getInfoAsync(rec.uri);
      if (!info?.exists) rec.uri = '';
    }
    return rec;
  } catch (e) {
    console.warn('[Disease] load last scan failed:', e);
    return null;
  }
}

async function clearLastScan(): Promise<void> {
  try {
    // Read the currently-persisted URI BEFORE we clear AsyncStorage so we
    // know which file to delete. Filenames are now timestamped per-scan.
    let toDelete: string | null = null;
    const raw = await AsyncStorage.getItem(LAST_SCAN_KEY);
    if (raw) {
      try { toDelete = (JSON.parse(raw) as PersistedScan).uri || null; } catch {}
    }
    await AsyncStorage.removeItem(LAST_SCAN_KEY);
    if (toDelete && FileSystem?.deleteAsync
        && FileSystem?.documentDirectory
        && toDelete.startsWith(FileSystem.documentDirectory)) {
      await FileSystem.deleteAsync(toDelete, { idempotent: true });
    }
    // Legacy cleanup: older builds wrote a fixed "last_scan.jpg" — remove it
    // if it still exists so it doesn't sit around forever.
    if (FileSystem?.documentDirectory && FileSystem?.deleteAsync) {
      await FileSystem.deleteAsync(`${FileSystem.documentDirectory}last_scan.jpg`, { idempotent: true });
    }
  } catch {}
}

// Bilingual "N ago" for the restored badge.
function ageLabel(iso: string): { en: string; kn: string } {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60)    return { en: 'just now',              kn: 'ಈಗಷ್ಟೇ' };
  if (s < 3600)  { const m = Math.round(s / 60);   return { en: `${m} min ago`,  kn: `${m} ನಿಮಿಷ ಹಿಂದೆ` }; }
  if (s < 86400) { const h = Math.round(s / 3600); return { en: `${h} h ago`,    kn: `${h} ಗಂಟೆ ಹಿಂದೆ` }; }
  const d = Math.round(s / 86400);
  return { en: `${d} d ago`, kn: `${d} ದಿನ ಹಿಂದೆ` };
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#F5F7F5',
  dark: '#0F1F17',
  darkCard: '#1A2E23',
  green: '#2D6A4F',
  greenBright: '#40916C',
  greenNeon: '#52B788',
  greenPale: '#D8F3DC',
  greenTint: '#F0FDF4',
  amber: '#D97706',
  amberBg: '#FEF3C7',
  red: '#DC2626',
  redBg: '#FEE2E2',
  card: '#FFFFFF',
  border: '#E8ECE9',
  textDark: '#0F1F17',
  textBody: '#2C3E37',
  textMuted: '#6B7A73',
  textLight: '#9CA8A1',
};

// ── Severity helpers ────────────────────────────────────────────────────────
type Sev = 'Low' | 'Medium' | 'High' | 'Critical';
function sevColor(sev: string) {
  switch (sev as Sev) {
    case 'Critical': return { fg: '#991B1B', bg: '#FEE2E2', label: 'Critical' };
    case 'High':     return { fg: C.red,   bg: C.redBg,   label: 'High' };
    case 'Medium':   return { fg: C.amber, bg: C.amberBg, label: 'Medium' };
    default:         return { fg: C.green, bg: C.greenPale, label: 'Low' };
  }
}

// ── Confidence gauge ────────────────────────────────────────────────────────
function ConfidenceBar({ value }: { value: number }) {
  // Width interpolation forces useNativeDriver: false. That's OK here:
  // this animation fires exactly ONCE per scan (900 ms), not on every
  // frame — so keeping it on the JS driver has no smoothness cost.
  // A scaleX + transform-origin rewrite would break the left-anchored
  // fill visual on Android (RN doesn't support transformOrigin uniformly).
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: value / 100, duration: 900,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [value]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const color = value >= 88 ? C.green : value >= 75 ? C.amber : C.red;
  return (
    <View style={{ height: 5, backgroundColor: '#EEF0F2', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
      <Animated.View style={{ height: '100%', width, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

// ── Scan line animation ────────────────────────────────────────────────────
function ScanLine({ active }: { active: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);
  const y = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 240] });
  if (!active) return null;
  return (
    <Animated.View style={[cf.line, { transform: [{ translateY: y }] }]} pointerEvents="none">
      <LinearGradient
        colors={['transparent', 'rgba(82, 183, 136, 0.9)', 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

function CropFrame({ isScanning }: { isScanning: boolean }) {
  const FRAME = 260, CORNER = 24, BORDER = 3;
  return (
    <View style={cf.container} pointerEvents="none">
      <View style={{ width: FRAME, height: FRAME, position: 'relative' }}>
        <View style={[cf.corner, { top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER, width: CORNER, height: CORNER }]} />
        <View style={[cf.corner, { top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER, width: CORNER, height: CORNER }]} />
        <View style={[cf.corner, { bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER, width: CORNER, height: CORNER }]} />
        <View style={[cf.corner, { bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER, width: CORNER, height: CORNER }]} />
        <ScanLine active={isScanning} />
      </View>
    </View>
  );
}
const cf = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', borderColor: '#52B788' },
  line: { position: 'absolute', top: 0, left: 4, right: 4, height: 3, borderRadius: 2 },
});

// ── Snap button ─────────────────────────────────────────────────────────────
function SnapButton({ onPress, isRunning }: any) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isRunning) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isRunning]);
  return (
    <View style={sb.wrap}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <TouchableOpacity activeOpacity={0.85} onPress={onPress} disabled={isRunning} style={sb.outer}>
          <View style={sb.mid}>
            <View style={sb.inner}>
              {isRunning ? <ActivityIndicator color="#FFF" /> : null}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
      <Text style={sb.label}>{isRunning ? 'Analysing…' : 'Tap to scan'}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 50, alignSelf: 'center', alignItems: 'center' },
  outer: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  mid: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  inner: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  label: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 8, opacity: 0.85 },
});

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function DiseaseScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<InferenceResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  // When we restore from disk on mount, `scanAt` holds the original scan
  // time so we can show a "N ago" badge — makes it obvious this is the
  // previous scan, not a fresh one. Set to null after a new scan runs.
  const [scanAt, setScanAt] = useState<string | null>(null);

  // Hydrate last diagnosis from AsyncStorage + documents dir on mount.
  // Runs once — no dep array item, so a re-render doesn't stomp a new scan.
  useEffect(() => {
    (async () => {
      const rec = await loadLastScan();
      if (rec) {
        if (rec.uri) setCapturedUri(rec.uri);
        setDiagnosis(rec.diagnosis);
        setScanAt(rec.at);
      }
    })();
  }, []);

  const cameraRef = useRef<CameraView>(null);
  const { isModelLoaded, isRunning, runInference, runtimeBroken, retryLoad } = useDiseaseDetection();

  const sheetSlide = useRef(new Animated.Value(SCREEN_H)).current;
  useEffect(() => {
    Animated.spring(sheetSlide, {
      toValue: showResult ? 0 : SCREEN_H,
      damping: 22, stiffness: 180, useNativeDriver: true,
    }).start();
  }, [showResult]);

  async function analyseUri(uri: string) {
    const result = await runInference(uri);
    setShowCamera(false);
    if (!result) {
      Alert.alert('Detection Failed', 'Could not analyse the image. Try a clearer photo.');
      return;
    }
    if (result.status === 'ok') {
      // Only commit the image + diagnosis together, so the "Last Diagnosis"
      // card can never show a new image against a stale disease label.
      setCapturedUri(uri);
      setDiagnosis(result);
      setShowResult(true);
      // Persist to disk so the card survives an app kill/restart. The
      // saved URI is a copy inside documentDirectory (see saveLastScan),
      // not the original camera-cache URI which the OS can purge.
      const rec = await saveLastScan(uri, result);
      if (rec) {
        setCapturedUri(rec.uri);
        setScanAt(rec.at);
      } else {
        setScanAt(new Date().toISOString());
      }
      return;
    }
    // Honest empty state — never guess a disease. Do NOT touch capturedUri
    // or diagnosis: leaving the previous good scan intact is fine; clobbering
    // one with the other is the bug.
    const title =
      result.status === 'not_a_leaf'   ? 'Not a Leaf'          :
      result.status === 'low_confidence' ? 'Not Sure Enough'   :
                                           'Detection Failed';
    Alert.alert(
      title,
      `${result.reason ?? ''}\n\n${result.hint ?? ''}`.trim(),
      [{ text: 'Try Again' }]
    );
  }

  async function handleSnap() {
    if (!cameraRef.current || isRunning) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) return;
      await analyseUri(photo.uri);
    } catch (e) {
      console.error('[Disease] snap error:', e);
      Alert.alert('Camera Error', 'Failed to capture photo.');
    }
  }

  async function pickFromGallery() {
    if (!ImagePicker) {
      Alert.alert(
        'Update Needed',
        'Gallery upload requires the latest app build. Please install the newest APK to enable this feature.',
        [{ text: 'OK' }]
      );
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant photo library access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets[0]?.uri) {
        await analyseUri(result.assets[0].uri);
      }
    } catch (e) {
      console.error('[Disease] gallery pick failed:', e);
      Alert.alert('Gallery Error', 'Could not open gallery. Try the newest APK.');
    }
  }

  // ── Camera overlay (fullscreen Modal — covers the tab bar, handles Android back) ──
  const cameraOverlay = (
    <Modal
      visible={showCamera}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => setShowCamera(false)}
    >
      {!permission?.granted ? (
        <SafeAreaView style={m.permSafe}>
          <View style={m.permBox}>
            <View style={m.permIconRing}>
              <Ionicons name="camera-outline" size={32} color={C.green} />
            </View>
            <Text style={m.permTitle}>Camera Access Needed</Text>
            <Text style={m.permSub}>We scan leaves on-device — nothing uploaded.</Text>
            <TouchableOpacity onPress={requestPermission} activeOpacity={0.9} style={m.permBtn}>
              <Text style={m.permBtnText}>Grant Permission</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCamera(false)} style={{ marginTop: 10 }}>
              <Text style={m.permCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {showCamera && (
            <CameraView ref={cameraRef} style={{ flex: 1 }} facing={'back' as CameraType} />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.7)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 140 }}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 220 }}
          />
          <CropFrame isScanning={isRunning} />

          <SafeAreaView style={m.camUI} edges={['top']}>
            <View style={m.camTopBar}>
              <TouchableOpacity style={m.camCloseBtn} onPress={() => setShowCamera(false)}>
                <Ionicons name="arrow-back" size={20} color="#FFF" />
              </TouchableOpacity>
              <View style={m.camPill}>
                <View style={[m.dot, { backgroundColor: isModelLoaded ? '#52B788' : '#F59E0B' }]} />
                <Text style={m.camPillText}>{isModelLoaded ? 'Model Ready' : 'Loading…'}</Text>
              </View>
              <TouchableOpacity style={m.camCloseBtn} onPress={pickFromGallery}>
                <Ionicons name="images" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
            <Text style={m.camHint}>Fill the frame with ONE close-up leaf</Text>
            <Text style={[m.camHint, { fontSize: 10, opacity: 0.7, marginTop: 2 }]}>
              Whole-plant / canopy shots cannot be diagnosed
            </Text>
          </SafeAreaView>

          {isRunning && (
            <View style={m.scanBanner}>
              <ActivityIndicator color="#52B788" size="small" />
              <Text style={m.scanBannerText}>Analysing with AI…</Text>
            </View>
          )}

          <SnapButton onPress={handleSnap} isRunning={isRunning} />
        </View>
      )}
    </Modal>
  );

  // ── Home view ─────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {cameraOverlay}
      {!isModelLoaded && !runtimeBroken && (
        <View style={m.loadingOverlay}>
          <View style={m.loadingBox}>
            <ActivityIndicator color={C.green} />
            <Text style={m.loadingText}>Loading AI…</Text>
          </View>
        </View>
      )}
      {runtimeBroken && (
        <View style={m.loadingOverlay}>
          <View style={[m.loadingBox, { maxWidth: 340 }]}>
            <Text style={[m.loadingText, { color: '#B91C1C', fontWeight: '700', textAlign: 'center' }]}>
              AI model failed to load
            </Text>
            {/* Show the ACTUAL error message on-screen so we can diagnose
                without needing adb logcat access. Farmer can screenshot
                this and send it if the retry doesn't clear things. */}
            {(() => {
              const err = getLastLoadError();
              return err ? (
                <Text
                  selectable
                  style={{
                    fontSize: 10, color: '#7F1D1D',
                    marginTop: 8, textAlign: 'left',
                    fontFamily: 'monospace',
                    backgroundColor: '#FEF2F2',
                    padding: 8, borderRadius: 6,
                    maxHeight: 120,
                  }}
                  numberOfLines={6}
                >
                  {err}
                </Text>
              ) : null;
            })()}
            <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 10, textAlign: 'center' }}>
              Tap Retry to try loading again.
            </Text>
            <TouchableOpacity
              onPress={retryLoad}
              activeOpacity={0.85}
              style={{
                marginTop: 12,
                backgroundColor: C.green, paddingHorizontal: 20, paddingVertical: 10,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: '#FFF', fontWeight: '700' }}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={m.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Header ── */}
          <View style={m.header}>
            <View>
              <Text style={m.hTitle}>Disease Scan</Text>
              <Text style={m.hKn}>ರೋಗ ಪತ್ತೆ</Text>
            </View>
            <View style={m.aiPill}>
              <MaterialCommunityIcons name="cpu-64-bit" size={11} color={C.green} />
              <Text style={m.aiPillText}>On-device AI</Text>
            </View>
          </View>

          {/* ── AI unavailable notice (only when TFLite runtime can't run on this device) ── */}
          {runtimeBroken && (
            <View style={m.unavailCard}>
              <View style={m.unavailIconWrap}>
                <MaterialCommunityIcons name="cpu-64-bit" size={18} color="#B45309" />
                <View style={m.unavailDot} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={m.unavailTitle}>On-device AI unavailable</Text>
                <Text style={m.unavailBody}>
                  We won&apos;t show a guessed diagnosis. Browse the Disease Library below to
                  identify symptoms by crop and appearance.
                </Text>
              </View>
            </View>
          )}

          {/* ── Hero Scan Card ── */}
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => setShowCamera(true)}
            disabled={!isModelLoaded || runtimeBroken}
            style={[m.heroWrap, runtimeBroken && { opacity: 0.55 }]}
          >
            <ImageBackground
              source={require('../../../assets/images/hero/diseasecardbgpic.png')}
              style={m.hero}
              imageStyle={{ borderRadius: 20 }}
              resizeMode="cover"
            >
              <LinearGradient
                colors={['rgba(15,31,23,0.85)', 'rgba(15,31,23,0.55)', 'rgba(15,31,23,0.25)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={m.heroOverlay}
              />
              <View style={{ maxWidth: '65%' }}>
                <View style={m.heroBadge}>
                  <Ionicons name="flash" size={9} color="#95D5B2" />
                  <Text style={m.heroBadgeText}>Offline · Private · Instant</Text>
                </View>
                <Text style={m.heroTitle}>Scan a crop leaf</Text>
                <Text style={m.heroSub}>Get accurate diagnosis and treatment in seconds</Text>

                <View style={m.heroBtn}>
                  <View style={m.heroBtnIcon}>
                    <Ionicons name="camera" size={16} color="#FFF" />
                  </View>
                  <Text style={m.heroBtnText}>Open Camera</Text>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>

          {/* ── Action Row: Gallery + Library ── */}
          <View style={m.actionRow}>
            <TouchableOpacity onPress={pickFromGallery} activeOpacity={0.85} style={m.actionCard}>
              <View style={[m.actionIconBox, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="images" size={16} color={C.amber} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={m.actionLabel}>From Gallery</Text>
                <Text style={m.actionKn}>ಗ್ಯಾಲರಿಯಿಂದ</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={C.textLight} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowLibrary(true)} activeOpacity={0.85} style={m.actionCard}>
              <View style={[m.actionIconBox, { backgroundColor: C.greenPale }]}>
                <MaterialCommunityIcons name="book-open-variant" size={16} color={C.green} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={m.actionLabel}>Disease Library</Text>
                <Text style={m.actionKn}>38 ರೋಗಗಳು</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={C.textLight} />
            </TouchableOpacity>
          </View>

          {/* ── How it works ── */}
          <Text style={m.sectionTitle}>How it works</Text>
          <View style={m.stepsCard}>
            <Step n="1" title="Take a clear photo" sub="ONE leaf, close-up, filling the frame. Not a whole-plant shot." />
            <Step n="2" title="AI analyses instantly" sub="MobileNetV2 · Tomato & Potato blights + Healthy" />
            <Step n="3" title="Get treatment advice" sub="Organic + Chemical + Nearest store" last />
          </View>

          {/* ── Last scan ── survives app restart via AsyncStorage +
               a copy in documentDirectory (see loadLastScan / saveLastScan).
               Renders even if the image file went missing — the diagnosis
               text is still valuable on its own. */}
          {diagnosis && diagnosis.status === 'ok' && (
            <>
              <View style={m.lastHeaderRow}>
                <Text style={[m.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>Last Diagnosis</Text>
                {scanAt && (
                  <View style={m.lastAgePill}>
                    <Ionicons name="time-outline" size={10} color={C.textMuted} />
                    <Text style={m.lastAgeText}>{ageLabel(scanAt).en}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={async () => {
                    await clearLastScan();
                    setDiagnosis(null);
                    setCapturedUri(null);
                    setScanAt(null);
                  }}
                  activeOpacity={0.7}
                  style={m.lastClearBtn}
                >
                  <Ionicons name="close" size={12} color={C.textMuted} />
                  <Text style={m.lastClearText}>Clear</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => setShowResult(true)}
                activeOpacity={0.9}
                style={m.lastCard}
              >
                {capturedUri ? (
                  <Image source={{ uri: capturedUri }} style={m.lastThumb} />
                ) : (
                  <View style={[m.lastThumb, m.lastThumbPlaceholder]}>
                    <Ionicons name="leaf-outline" size={22} color={C.textLight} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={m.lastCrop}>{diagnosis.affected_crop}</Text>
                  <Text style={m.lastDisease}>{diagnosis.disease_name}</Text>
                  <View style={m.lastMetaRow}>
                    <View style={[m.sevChip, { backgroundColor: sevColor(diagnosis.severity).bg }]}>
                      <Text style={[m.sevChipText, { color: sevColor(diagnosis.severity).fg }]}>
                        {sevColor(diagnosis.severity).label}
                      </Text>
                    </View>
                    <Text style={m.lastConf}>{diagnosis.confidence}% confidence</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textLight} />
              </TouchableOpacity>
            </>
          )}

          <View style={{ height: 110 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ── Result Bottom Sheet ── */}
      <ResultSheet
        visible={showResult}
        onClose={() => setShowResult(false)}
        diagnosis={diagnosis}
        capturedUri={capturedUri}
        slide={sheetSlide}
        onRescan={() => {
          setShowResult(false);
          setTimeout(() => setShowCamera(true), 250);
        }}
      />

      {/* ── Disease Library ── */}
      <DiseaseLibrary visible={showLibrary} onClose={() => setShowLibrary(false)} />
    </View>
  );
}

// ── Result Sheet ────────────────────────────────────────────────────────────
function ResultSheet({ visible, onClose, diagnosis, capturedUri, slide, onRescan }: any) {
  const [feedback, setFeedback] = React.useState<null | 'correct' | 'wrong'>(null);
  React.useEffect(() => { setFeedback(null); }, [diagnosis?.classIndex, capturedUri]);
  if (!diagnosis || !capturedUri) return null;
  const sev = sevColor(diagnosis.severity);

  async function markFeedback(kind: 'correct' | 'wrong') {
    if (feedback) return;
    setFeedback(kind);
    try {
      await recordScanFeedback(
        capturedUri,
        diagnosis.classIndex,
        diagnosis.classLabel || diagnosis.disease_name,
        (diagnosis.confidence ?? 0) / 100,
        kind === 'correct',
      );
    } catch { /* non-fatal */ }
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={m.sheetBackdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[m.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={m.sheetHandle} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
          {/* Leaf hero */}
          <View style={m.leafHeroWrap}>
            <Image source={{ uri: capturedUri }} style={m.leafHero} />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.75)']}
              style={m.leafHeroGradient}
            />
            <View style={m.leafHeroTL}>
              <View style={[m.sevChip, { backgroundColor: sev.bg }]}>
                <Ionicons
                  name={diagnosis.severity === 'Low' ? 'checkmark-circle' : 'warning'}
                  size={10} color={sev.fg}
                />
                <Text style={[m.sevChipText, { color: sev.fg }]}>{sev.label} Severity</Text>
              </View>
            </View>
            <View style={m.leafHeroBottom}>
              <Text style={m.leafCrop}>{diagnosis.affected_crop}</Text>
              <Text style={m.leafDisease}>{diagnosis.disease_name}</Text>
              {!!diagnosis.kannada_name && (
                <Text style={m.leafKn}>{diagnosis.kannada_name}</Text>
              )}
            </View>
          </View>

          <View style={m.detailBlock}>
            {!!diagnosis.scientific_name && (
              <Text style={m.sciName}>{diagnosis.scientific_name}</Text>
            )}
            <View style={m.confRow}>
              <View style={{ flex: 1 }}>
                <Text style={m.confLabel}>AI Confidence</Text>
                <ConfidenceBar value={diagnosis.confidence} />
              </View>
              <View style={m.confBox}>
                <Text style={m.confValue}>{diagnosis.confidence}</Text>
                <Text style={m.confPct}>%</Text>
              </View>
            </View>
          </View>

          {/* Top-3 alternatives — never hide what the model was uncertain about */}
          {Array.isArray(diagnosis.topProbs) && diagnosis.topProbs.length > 1 && (
            <View style={m.top3Box}>
              <Text style={m.top3Label}>Also considered</Text>
              {diagnosis.topProbs.slice(1, 3).map((tp: any, i: number) => (
                <View key={i} style={m.top3Row}>
                  <Text style={m.top3Name}>{tp.label}</Text>
                  <Text style={m.top3Pct}>{Math.round(tp.prob * 100)}%</Text>
                </View>
              ))}
            </View>
          )}

          {/* Consult-officer disclaimer — every result, non-dismissable */}
          <View style={m.disclaimer}>
            <MaterialCommunityIcons name="alert-circle-outline" size={14} color="#B45309" />
            <Text style={m.disclaimerText}>
              AI suggestion only. Confirm with your local Krishi Vigyan Kendra or
              extension officer before spraying chemicals.
            </Text>
          </View>

          {/* Both treatments shown together */}
          <Text style={m.tSectionLabel}>Treatment Options · ಚಿಕಿತ್ಸೆ</Text>

          {/* Organic (offline, always) */}
          {!!diagnosis.organic_treatment && (
            <View style={m.tCard}>
              <View style={m.tCardHeader}>
                <View style={[m.tIconBox, { backgroundColor: C.greenPale }]}>
                  <MaterialCommunityIcons name="leaf" size={14} color={C.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={m.tHeaderRow}>
                    <Text style={m.tTypeName}>Organic</Text>
                    <View style={m.offlineBadge}>
                      <Ionicons name="cloud-offline" size={8} color={C.green} />
                      <Text style={m.offlineBadgeText}>Offline</Text>
                    </View>
                  </View>
                  <Text style={m.tKn}>ಸಾವಯವ · Available at home</Text>
                </View>
              </View>
              <Text style={m.tTitle}>{diagnosis.organic_treatment}</Text>
              {!!diagnosis.organic_dosage && (
                <Text style={m.tDosage}><Text style={{ fontFamily: 'Inter_700Bold' }}>Dosage: </Text>{diagnosis.organic_dosage}</Text>
              )}
            </View>
          )}

          {/* Chemical (with store lookup) */}
          {!!diagnosis.chemical_treatment && (
            <View style={m.tCard}>
              <View style={m.tCardHeader}>
                <View style={[m.tIconBox, { backgroundColor: C.amberBg }]}>
                  <MaterialCommunityIcons name="flask" size={14} color={C.amber} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={m.tHeaderRow}>
                    <Text style={m.tTypeName}>Chemical</Text>
                    <View style={[m.offlineBadge, { backgroundColor: C.amberBg }]}>
                      <Ionicons name="storefront" size={8} color={C.amber} />
                      <Text style={[m.offlineBadgeText, { color: C.amber }]}>Buy at store</Text>
                    </View>
                  </View>
                  <Text style={m.tKn}>ರಾಸಾಯನಿಕ · Faster action</Text>
                </View>
              </View>
              <Text style={m.tTitle}>{diagnosis.chemical_treatment}</Text>
              {!!diagnosis.chemical_dosage && (
                <Text style={m.tDosage}><Text style={{ fontFamily: 'Inter_700Bold' }}>Dosage: </Text>{diagnosis.chemical_dosage}</Text>
              )}

              {/* Nearest store lookup */}
              {!!diagnosis.store_product && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    // Search Google Maps for the actual product name near the
                    // farmer's current location. Google's map app uses device
                    // GPS to bias results — the farmer sees real nearby
                    // agri-stores, not fabricated names we can't verify.
                    const q = encodeURIComponent(`${diagnosis.store_product} agri store near me`);
                    Linking.openURL(`https://www.google.com/maps/search/${q}`);
                  }}
                  style={m.storeBtn}
                >
                  <View style={m.storeLeft}>
                    <FontAwesome5 name="store" size={11} color={C.amber} />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <Text style={m.storeLabel}>Find nearby store</Text>
                      <Text style={m.storeProduct}>{diagnosis.store_product}</Text>
                    </View>
                  </View>
                  <View style={m.storeAction}>
                    <Ionicons name="location" size={11} color={C.amber} />
                    <Text style={m.storeActionText}>Map</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Prevention */}
          {!!diagnosis.prevention && (
            <View style={m.prevCard}>
              <View style={m.prevIcon}>
                <MaterialCommunityIcons name="shield-check" size={14} color={C.green} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={m.prevTitle}>Prevention · ತಡೆಗಟ್ಟುವಿಕೆ</Text>
                <Text style={m.prevBody}>{diagnosis.prevention}</Text>
              </View>
            </View>
          )}

          {/* Farmer feedback — one tap feeds the next model training */}
          <View style={m.fbBox}>
            <Text style={m.fbTitle}>Was this correct?</Text>
            <View style={m.fbRow}>
              <TouchableOpacity
                onPress={() => markFeedback('correct')}
                disabled={!!feedback}
                activeOpacity={0.85}
                style={[m.fbBtn, feedback === 'correct' && m.fbBtnCorrect]}
              >
                <Ionicons name="checkmark-circle" size={14}
                  color={feedback === 'correct' ? '#FFF' : C.green} />
                <Text style={[m.fbBtnText, feedback === 'correct' && { color: '#FFF' }]}>
                  Yes, correct
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => markFeedback('wrong')}
                disabled={!!feedback}
                activeOpacity={0.85}
                style={[m.fbBtn, feedback === 'wrong' && m.fbBtnWrong]}
              >
                <Ionicons name="close-circle" size={14}
                  color={feedback === 'wrong' ? '#FFF' : C.red} />
                <Text style={[m.fbBtnText, feedback === 'wrong' && { color: '#FFF' }]}>
                  No, wrong
                </Text>
              </TouchableOpacity>
            </View>
            {feedback && (
              <Text style={m.fbThanks}>
                Thanks — your feedback helps improve future predictions.
              </Text>
            )}
          </View>

          {/* Actions */}
          <View style={m.sheetBtnRow}>
            <TouchableOpacity style={m.sheetBtnSecondary} onPress={onRescan} activeOpacity={0.85}>
              <Ionicons name="camera" size={13} color={C.green} />
              <Text style={m.sheetBtnSecondaryText}>Scan Again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} activeOpacity={0.9} style={{ flex: 1 }}>
              <LinearGradient colors={[C.green, C.dark]} style={m.sheetBtnPrimary}>
                <Text style={m.sheetBtnPrimaryText}>Got it</Text>
                <Ionicons name="checkmark" size={15} color="#FFF" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Disease Library ─────────────────────────────────────────────────────────
const LIBRARY_ITEMS: { crop: string; kn: string; count: number; icon: string; color: string }[] = [
  { crop: 'Tomato',     kn: 'ಟೊಮ್ಯಾಟೊ',   count: 10, icon: '🍅', color: '#FEE2E2' },
  { crop: 'Potato',     kn: 'ಆಲೂಗಡ್ಡೆ',    count: 3,  icon: '🥔', color: '#FEF3C7' },
  { crop: 'Corn',       kn: 'ಜೋಳ',        count: 4,  icon: '🌽', color: '#FEF3C7' },
  { crop: 'Apple',      kn: 'ಸೇಬು',       count: 4,  icon: '🍎', color: '#FEE2E2' },
  { crop: 'Grape',      kn: 'ದ್ರಾಕ್ಷಿ',    count: 4,  icon: '🍇', color: '#F3E8FF' },
  { crop: 'Pepper',     kn: 'ಮೆಣಸಿನಕಾಯಿ',  count: 2,  icon: '🌶️', color: '#FEE2E2' },
  { crop: 'Strawberry', kn: 'ಸ್ಟ್ರಾಬೆರಿ',   count: 2,  icon: '🍓', color: '#FEE2E2' },
  { crop: 'Cherry',     kn: 'ಚೆರ್ರಿ',      count: 2,  icon: '🍒', color: '#FEE2E2' },
  { crop: 'Peach',      kn: 'ಪೀಚ್',        count: 2,  icon: '🍑', color: '#FED7AA' },
  { crop: 'Orange',     kn: 'ಕಿತ್ತಳೆ',      count: 1,  icon: '🍊', color: '#FED7AA' },
  { crop: 'Blueberry',  kn: 'ಬ್ಲೂಬೆರಿ',    count: 1,  icon: '🫐', color: '#DBEAFE' },
  { crop: 'Raspberry',  kn: 'ರಾಸ್ಪ್ಬೆರಿ',  count: 1,  icon: '🫐', color: '#FEE2E2' },
  { crop: 'Soybean',    kn: 'ಸೋಯಾಬೀನ್',    count: 1,  icon: '🫘', color: '#FEF3C7' },
  { crop: 'Squash',     kn: 'ಸೋರೆಕಾಯಿ',   count: 1,  icon: '🎃', color: '#FED7AA' },
];

function DiseaseLibrary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const slide = useRef(new Animated.Value(SCREEN_H)).current;
  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : SCREEN_H,
      damping: 22, stiffness: 180, useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={m.sheetBackdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[m.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={m.sheetHandle} />
        <View style={m.libHeader}>
          <View>
            <Text style={m.libTitle}>Disease Library</Text>
            <Text style={m.libSub}>38 diseases across 14 crops · ರೋಗಗಳ ಗ್ರಂಥಾಲಯ</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={m.libClose}>
            <Ionicons name="close" size={16} color={C.textDark} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={m.libGrid} showsVerticalScrollIndicator={false}>
          {LIBRARY_ITEMS.map((item) => (
            <View key={item.crop} style={m.libItem}>
              <View style={[m.libIcon, { backgroundColor: item.color }]}>
                <Text style={{ fontSize: 22 }}>{item.icon}</Text>
              </View>
              <Text style={m.libItemCrop}>{item.crop}</Text>
              <Text style={m.libItemKn}>{item.kn}</Text>
              <Text style={m.libItemCount}>{item.count} {item.count === 1 ? 'disease' : 'diseases'}</Text>
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Small components ────────────────────────────────────────────────────────
function Step({ n, title, sub, last }: any) {
  return (
    <View style={[m.stepRow, !last && m.stepBorder]}>
      <View style={m.stepNum}><Text style={m.stepNumText}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={m.stepTitle}>{title}</Text>
        <Text style={m.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  scroll: { padding: 16 },

  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(245,247,245,0.94)', zIndex: 999, justifyContent: 'center', alignItems: 'center' },
  loadingBox: { alignItems: 'center', backgroundColor: '#FFF', padding: 22, borderRadius: 16, elevation: 6 },
  loadingText: { marginTop: 8, fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  hTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.textDark, letterSpacing: -0.3 },
  hKn: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted, marginTop: 1 },
  aiPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.greenPale, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  aiPillText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.green },

  unavailCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 14, padding: 14, marginBottom: 12,
  },
  unavailIconWrap: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: '#FEF3C7',
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  unavailDot: {
    position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#DC2626', borderWidth: 1.5, borderColor: '#FFFBEB',
  },
  unavailTitle: { color: '#78350F', fontFamily: 'Inter_700Bold', fontSize: 13.5 },
  unavailBody: {
    color: '#92400E', fontFamily: 'Inter_400Regular', fontSize: 12,
    marginTop: 3, lineHeight: 17,
  },


  heroWrap: {
    borderRadius: 20, overflow: 'hidden',
    shadowColor: C.dark, shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  hero: { padding: 18, minHeight: 180, justifyContent: 'center', overflow: 'hidden' },
  heroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroOrbit: { position: 'absolute', borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.15)' },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: 'rgba(82, 183, 136, 0.15)', borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.3)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  heroBadgeText: { color: '#95D5B2', fontFamily: 'Inter_700Bold', fontSize: 10 },
  heroTitle: { color: '#FFF', fontFamily: 'Inter_800ExtraBold', fontSize: 22, marginTop: 10, letterSpacing: -0.5 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4, lineHeight: 17 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 14,
  },
  heroBtnIcon: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  heroBtnText: { marginLeft: 8, color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 13 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  actionIconBox: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },
  actionKn: { fontFamily: 'Inter_400Regular', fontSize: 9, color: C.textMuted, marginTop: 1 },

  sectionTitle: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: C.textDark,
    letterSpacing: -0.2, marginTop: 18, marginBottom: 8,
  },

  stepsCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  stepBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.greenPale, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  stepNumText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: C.green },
  stepTitle: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },
  stepSub: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted, marginTop: 1 },

  lastCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  lastThumb: { width: 46, height: 46, borderRadius: 10, backgroundColor: C.greenPale },
  lastThumbPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.greenPale },
  lastHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 20, marginBottom: 8,
  },
  lastAgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.bg, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: C.border,
  },
  lastAgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: C.textMuted },
  lastClearBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  lastClearText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.textMuted },
  lastCrop: { fontFamily: 'Inter_600SemiBold', fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  lastDisease: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark, marginTop: 1 },
  lastMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  lastConf: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },
  sevChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  sevChipText: { fontFamily: 'Inter_700Bold', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Camera
  camUI: { paddingHorizontal: 16, paddingTop: 10 },
  camTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  camCloseBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  camPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  camPillText: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  camHint: { color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium', fontSize: 11, textAlign: 'center', marginTop: 16 },
  scanBanner: {
    position: 'absolute', top: 200, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.75)', borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.5)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18,
  },
  scanBannerText: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 11 },

  permSafe: { flex: 1, backgroundColor: C.bg },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  permIconRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.greenPale, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  permTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.textDark },
  permSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 17 },
  permBtn: { backgroundColor: C.green, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  permBtnText: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 13 },
  permCancel: { color: C.textMuted, fontFamily: 'Inter_500Medium', fontSize: 12 },

  // Bottom sheet
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: SCREEN_H * 0.92, paddingTop: 6,
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#D5DBD7', alignSelf: 'center', marginBottom: 4 },

  leafHeroWrap: { margin: 14, borderRadius: 18, overflow: 'hidden', height: 170, position: 'relative' },
  leafHero: { width: '100%', height: '100%' },
  leafHeroGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  leafHeroTL: { position: 'absolute', top: 10, left: 10 },
  leafHeroBottom: { position: 'absolute', bottom: 12, left: 14, right: 14 },
  leafCrop: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 0.5 },
  leafDisease: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: '#FFF', marginTop: 2 },
  leafKn: { fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  detailBlock: { paddingHorizontal: 16, paddingBottom: 4 },
  sciName: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textMuted, fontStyle: 'italic', marginBottom: 10 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  confLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.textBody },
  confBox: { flexDirection: 'row', alignItems: 'flex-end' },
  confValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, color: C.textDark, letterSpacing: -0.5, lineHeight: 26 },
  confPct: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textMuted, marginLeft: 1, marginBottom: 3 },

  top3Box: {
    marginHorizontal: 16, marginTop: 10, padding: 10,
    backgroundColor: '#F7FBF8', borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
  },
  top3Label: {
    fontFamily: 'Inter_700Bold', fontSize: 10, color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
  },
  top3Row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 3,
  },
  top3Name: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: C.textBody },
  top3Pct: { fontFamily: 'Inter_700Bold', fontSize: 11.5, color: C.textMuted },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 16, marginTop: 10, padding: 10,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 10,
  },
  disclaimerText: {
    flex: 1, fontFamily: 'Inter_500Medium', fontSize: 10.5,
    color: '#78350F', lineHeight: 15,
  },

  fbBox: {
    marginHorizontal: 16, marginTop: 16, padding: 12,
    backgroundColor: '#F7FBF8', borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
  },
  fbTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark,
    marginBottom: 8,
  },
  fbRow: { flexDirection: 'row', gap: 8 },
  fbBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  fbBtnCorrect: { backgroundColor: C.green, borderColor: C.green },
  fbBtnWrong:   { backgroundColor: C.red,   borderColor: C.red   },
  fbBtnText: { fontFamily: 'Inter_700Bold', fontSize: 11.5, color: C.textDark },
  fbThanks: {
    marginTop: 6, fontFamily: 'Inter_500Medium', fontSize: 10.5,
    color: C.textMuted, textAlign: 'center',
  },

  tSectionLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 16, marginBottom: 8, paddingHorizontal: 16,
  },

  tCard: {
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#FAFBFA', borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  tCardHeader: { flexDirection: 'row', alignItems: 'center' },
  tIconBox: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tTypeName: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: C.textDark },
  tKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 1 },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.greenPale, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  offlineBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 8, color: C.green, textTransform: 'uppercase', letterSpacing: 0.3 },
  tTitle: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark, marginTop: 10 },
  tDosage: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textBody, marginTop: 4, lineHeight: 16 },

  storeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FED7AA',
    borderRadius: 10, padding: 10, marginTop: 10,
  },
  storeLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  storeLabel: { fontFamily: 'Inter_500Medium', fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  storeProduct: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textDark, marginTop: 1 },
  storeAction: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.amberBg, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  storeActionText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.amber },

  prevCard: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 6,
    backgroundColor: C.greenTint, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  prevIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.greenPale, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  prevTitle: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.green, textTransform: 'uppercase', letterSpacing: 0.3 },
  prevBody: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textBody, marginTop: 3, lineHeight: 16 },

  sheetBtnRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 14 },
  sheetBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingHorizontal: 18, height: 46, borderRadius: 12,
    backgroundColor: C.greenTint, borderWidth: 1, borderColor: '#B7E4C7',
  },
  sheetBtnSecondaryText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.green },
  sheetBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    height: 46, borderRadius: 12,
  },
  sheetBtnPrimaryText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: '#FFF' },

  // Library
  libHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  libTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.textDark, letterSpacing: -0.3 },
  libSub: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textMuted, marginTop: 2 },
  libClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  libGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8 },
  libItem: {
    width: (SCREEN_W - 32 - 16) / 3, backgroundColor: '#FAFBFA',
    borderRadius: 12, padding: 10, alignItems: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  libIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  libItemCrop: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textDark },
  libItemKn: { fontFamily: 'Inter_400Regular', fontSize: 9, color: C.textMuted, marginTop: 1 },
  libItemCount: { fontFamily: 'Inter_600SemiBold', fontSize: 9, color: C.green, marginTop: 4 },
});
