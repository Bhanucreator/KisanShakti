import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert,
  ActivityIndicator, Animated, Easing, Dimensions, Modal, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeGradient as LinearGradient } from '../../components/safe-gradient';
import { Ionicons, MaterialCommunityIcons, FontAwesome5, Feather } from '@expo/vector-icons';
import { useDiseaseDetection, InferenceResult } from '../../hooks/use-disease-detection';

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

  const cameraRef = useRef<CameraView>(null);
  const { isModelLoaded, isRunning, runInference } = useDiseaseDetection();

  const sheetSlide = useRef(new Animated.Value(SCREEN_H)).current;
  useEffect(() => {
    Animated.spring(sheetSlide, {
      toValue: showResult ? 0 : SCREEN_H,
      damping: 22, stiffness: 180, useNativeDriver: true,
    }).start();
  }, [showResult]);

  async function analyseUri(uri: string) {
    setCapturedUri(uri);
    const result = await runInference(uri);
    setShowCamera(false);
    if (result) {
      setDiagnosis(result);
      setShowResult(true);
    } else {
      Alert.alert('Detection Failed', 'Could not analyse the image. Try a clearer photo.');
    }
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
  }

  // ── Camera view ─────────────────────────
  if (showCamera) {
    if (!permission?.granted) {
      return (
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
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing={'back' as CameraType} />
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
              <Ionicons name="close" size={18} color="#FFF" />
            </TouchableOpacity>
            <View style={m.camPill}>
              <View style={[m.dot, { backgroundColor: isModelLoaded ? '#52B788' : '#F59E0B' }]} />
              <Text style={m.camPillText}>{isModelLoaded ? 'Model Ready' : 'Loading…'}</Text>
            </View>
            <TouchableOpacity style={m.camCloseBtn} onPress={pickFromGallery}>
              <Ionicons name="images" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
          <Text style={m.camHint}>Fill the frame with one leaf</Text>
        </SafeAreaView>

        {isRunning && (
          <View style={m.scanBanner}>
            <ActivityIndicator color="#52B788" size="small" />
            <Text style={m.scanBannerText}>Analysing with AI…</Text>
          </View>
        )}

        <SnapButton onPress={handleSnap} isRunning={isRunning} />
      </View>
    );
  }

  // ── Home view ─────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {!isModelLoaded && (
        <View style={m.loadingOverlay}>
          <View style={m.loadingBox}>
            <ActivityIndicator color={C.green} />
            <Text style={m.loadingText}>Loading AI…</Text>
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

          {/* ── Hero Scan Card ── */}
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => setShowCamera(true)}
            disabled={!isModelLoaded}
            style={m.heroWrap}
          >
            <LinearGradient
              colors={['#1A2E23', '#0F1F17']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={m.hero}
            >
              <View style={[m.heroOrbit, { width: 220, height: 220, right: -80, top: -80 }]} />
              <View style={[m.heroOrbit, { width: 160, height: 160, right: -40, top: -40, opacity: 0.5 }]} />

              <View style={m.heroBadge}>
                <Ionicons name="flash" size={9} color="#95D5B2" />
                <Text style={m.heroBadgeText}>Offline · Private · Instant</Text>
              </View>
              <Text style={m.heroTitle}>Scan a crop leaf</Text>
              <Text style={m.heroSub}>Get diagnosis + treatment in seconds</Text>

              <View style={m.heroBtn}>
                <View style={m.heroBtnIcon}>
                  <Ionicons name="camera" size={18} color={C.dark} />
                </View>
                <Text style={m.heroBtnText}>Open Camera</Text>
                <Ionicons name="arrow-forward" size={16} color="#FFF" />
              </View>
            </LinearGradient>
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
            <Step n="1" title="Take a clear photo" sub="Fill the frame with one leaf" />
            <Step n="2" title="AI analyses instantly" sub="MobileNetV2 · 38 disease classes" />
            <Step n="3" title="Get treatment advice" sub="Organic + Chemical + Nearest store" last />
          </View>

          {/* ── Last scan ── */}
          {diagnosis && capturedUri && (
            <>
              <Text style={m.sectionTitle}>Last Diagnosis</Text>
              <TouchableOpacity
                onPress={() => setShowResult(true)}
                activeOpacity={0.9}
                style={m.lastCard}
              >
                <Image source={{ uri: capturedUri }} style={m.lastThumb} />
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
  if (!diagnosis || !capturedUri) return null;
  const sev = sevColor(diagnosis.severity);

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
                    const q = encodeURIComponent(`${diagnosis.store_product} agri store Kolar Karnataka`);
                    Linking.openURL(`https://www.google.com/maps/search/${q}`);
                  }}
                  style={m.storeBtn}
                >
                  <View style={m.storeLeft}>
                    <FontAwesome5 name="store" size={11} color={C.amber} />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <Text style={m.storeLabel}>Nearest agri-store</Text>
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

  heroWrap: {
    borderRadius: 20, overflow: 'hidden',
    shadowColor: C.dark, shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  hero: { padding: 18, minHeight: 200, justifyContent: 'space-between' },
  heroOrbit: { position: 'absolute', borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.15)' },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: 'rgba(82, 183, 136, 0.15)', borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.3)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  heroBadgeText: { color: '#95D5B2', fontFamily: 'Inter_700Bold', fontSize: 10 },
  heroTitle: { color: '#FFF', fontFamily: 'Inter_800ExtraBold', fontSize: 22, marginTop: 10, letterSpacing: -0.5 },
  heroSub: { color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14, padding: 10, marginTop: 16,
  },
  heroBtnIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  heroBtnText: { flex: 1, marginLeft: 10, color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 13 },

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
