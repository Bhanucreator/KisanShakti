import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, Alert,
  ActivityIndicator, Animated, Easing, Dimensions, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { SafeGradient as LinearGradient } from '../../components/safe-gradient';
import { Ionicons, MaterialCommunityIcons, Feather, FontAwesome5 } from '@expo/vector-icons';
import { useDiseaseDetection, InferenceResult } from '../../hooks/use-disease-detection';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  primaryDark: '#1B4332',
  primary: '#2D6A4F',
  primaryLight: '#40916C',
  primaryBright: '#52B788',
  primaryPale: '#D8F3DC',
  primaryTint: '#F0FDF4',
  amber: '#D97706',
  amberBg: '#FEF3C7',
  red: '#DC2626',
  redBg: '#FEE2E2',
  bg: '#F8F9FA',
  card: '#FFFFFF',
  border: '#E5E7EB',
  textDark: '#111827',
  textBody: '#374151',
  textMuted: '#6B7A99',
  textLight: '#9CA3AF',
};

// ── Severity color mapping ──────────────────────────────────────────────────
type Sev = 'Low' | 'Medium' | 'High' | 'Critical';
function sevColor(sev: string): { fg: string; bg: string; label: string } {
  switch (sev as Sev) {
    case 'Critical': return { fg: '#991B1B', bg: '#FEE2E2', label: 'Critical' };
    case 'High':     return { fg: C.red,   bg: C.redBg,   label: 'High' };
    case 'Medium':   return { fg: C.amber, bg: C.amberBg, label: 'Medium' };
    default:         return { fg: C.primary, bg: C.primaryPale, label: 'Low' };
  }
}

// ── Animated confidence gauge ───────────────────────────────────────────────
function ConfidenceGauge({ value }: { value: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: value / 100,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const color = value >= 80 ? C.primary : value >= 60 ? C.amber : C.red;
  return (
    <View style={g.wrap}>
      <View style={g.track}>
        <Animated.View style={[g.fill, { width, backgroundColor: color }]} />
      </View>
    </View>
  );
}
const g = StyleSheet.create({
  wrap: { marginTop: 8 },
  track: { height: 6, backgroundColor: '#EEF0F2', borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
});

// ── Animated scan line for camera ───────────────────────────────────────────
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
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 240] });
  if (!active) return null;
  return (
    <Animated.View style={[cf.line, { transform: [{ translateY }] }]} pointerEvents="none">
      <LinearGradient
        colors={['transparent', 'rgba(82, 183, 136, 0.9)', 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ flex: 1, borderRadius: 3 }}
      />
    </Animated.View>
  );
}

// ── Camera crop-frame overlay ───────────────────────────────────────────────
function CropFrame({ isScanning }: { isScanning: boolean }) {
  const FRAME = 260;
  const CORNER = 26;
  const BORDER = 3;
  return (
    <View style={cf.container} pointerEvents="none">
      <View style={{ width: FRAME, height: FRAME, position: 'relative' }}>
        <View style={[cf.corner, { top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER, width: CORNER, height: CORNER }]} />
        <View style={[cf.corner, { top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER, width: CORNER, height: CORNER }]} />
        <View style={[cf.corner, { bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER, width: CORNER, height: CORNER }]} />
        <View style={[cf.corner, { bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER, width: CORNER, height: CORNER }]} />
        <ScanLine active={isScanning} />
      </View>
      <View style={cf.hintPill}>
        <MaterialCommunityIcons name="leaf" size={14} color="#95D5B2" />
        <Text style={cf.hintText}>Center a single leaf</Text>
      </View>
    </View>
  );
}
const cf = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', borderColor: '#52B788' },
  line: { position: 'absolute', top: 0, left: 4, right: 4, height: 3, borderRadius: 2 },
  hintPill: {
    position: 'absolute', bottom: SCREEN_H * 0.28,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.4)',
  },
  hintText: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});

// ── Pulsing snap button ─────────────────────────────────────────────────────
function SnapButton({ onPress, isRunning }: { onPress: () => void; isRunning: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isRunning) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRunning]);

  return (
    <View style={sb.wrap}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPress}
          disabled={isRunning}
          style={sb.outerRing}
        >
          <View style={sb.midRing}>
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
  wrap: { position: 'absolute', bottom: 40, alignSelf: 'center', alignItems: 'center' },
  outerRing: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  midRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  inner: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  label: {
    color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 12,
    marginTop: 10, opacity: 0.85,
  },
});

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function DiseaseScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<InferenceResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [treatmentTab, setTreatmentTab] = useState<'organic' | 'chemical'>('organic');

  const cameraRef = useRef<CameraView>(null);
  const { isModelLoaded, isRunning, runInference } = useDiseaseDetection();

  const sheetSlide = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (showResult) {
      Animated.spring(sheetSlide, { toValue: 0, damping: 22, stiffness: 180, useNativeDriver: true }).start();
    } else {
      Animated.timing(sheetSlide, { toValue: SCREEN_H, duration: 220, useNativeDriver: true }).start();
    }
  }, [showResult]);

  async function handleSnap() {
    if (!cameraRef.current || isRunning) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) return;
      setCapturedUri(photo.uri);
      const result = await runInference(photo.uri);
      setShowCamera(false);
      if (result) {
        setDiagnosis(result);
        setShowResult(true);
      } else {
        Alert.alert('Detection Failed', 'Could not analyse the image. Please try again with a clearer photo.');
      }
    } catch (e) {
      console.error('[Disease] snap error:', e);
      Alert.alert('Camera Error', 'Failed to capture or analyse photo.');
    }
  }

  // ── Full-screen camera view ──
  if (showCamera) {
    if (!permission?.granted) {
      return (
        <SafeAreaView style={m.permSafe}>
          <View style={m.permBox}>
            <View style={m.permIconRing}>
              <Ionicons name="camera-outline" size={40} color={C.primary} />
            </View>
            <Text style={m.permTitle}>Camera Access Needed</Text>
            <Text style={m.permSubtitle}>
              We use your camera to scan leaves for disease{'\n'}on-device — nothing is uploaded.
            </Text>
            <TouchableOpacity onPress={requestPermission} activeOpacity={0.9} style={{ marginTop: 24 }}>
              <LinearGradient colors={[C.primary, C.primaryDark]} style={m.permBtn}>
                <Text style={m.permBtnText}>Grant Permission</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCamera(false)} style={{ marginTop: 14 }}>
              <Text style={{ color: C.textMuted, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing={'back' as CameraType}>
          {/* Dimmed corners for cinematic focus */}
          <LinearGradient
            colors={['rgba(0,0,0,0.7)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 140 }}
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.75)']}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 200 }}
          />

          <CropFrame isScanning={isRunning} />

          <SafeAreaView style={m.camUI} edges={['top']}>
            <View style={m.camTopBar}>
              <TouchableOpacity style={m.camCloseBtn} onPress={() => setShowCamera(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color="#FFF" />
              </TouchableOpacity>
              <View style={m.camTitleBox}>
                <Text style={m.camTitle}>AI Scan</Text>
                <Text style={m.camTitleKn}>AI ಸ್ಕ್ಯಾನ್</Text>
              </View>
              <View style={m.camModelPill}>
                <View style={[m.dot, { backgroundColor: isModelLoaded ? '#52B788' : '#F59E0B' }]} />
                <Text style={m.camModelText}>{isModelLoaded ? 'Model Ready' : 'Loading…'}</Text>
              </View>
            </View>

            {isRunning && (
              <View style={m.scanBanner}>
                <ActivityIndicator color="#52B788" size="small" />
                <Text style={m.scanBannerText}>Analysing leaf with AI…</Text>
              </View>
            )}
          </SafeAreaView>

          <SnapButton onPress={handleSnap} isRunning={isRunning} />
        </CameraView>
      </View>
    );
  }

  // ── Home view ──
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {!isModelLoaded && (
        <View style={m.loadingOverlay}>
          <View style={m.loadingBox}>
            <ActivityIndicator color={C.primary} size="large" />
            <Text style={m.loadingText}>Loading AI Model…</Text>
            <Text style={m.loadingSub}>Preparing on-device detection</Text>
          </View>
        </View>
      )}

      <SafeAreaView style={m.safe} edges={['top']}>
        <ScrollView contentContainerStyle={m.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Header ── */}
          <View style={m.header}>
            <View>
              <Text style={m.hTitle}>Disease Scan</Text>
              <Text style={m.hTitleKn}>ರೋಗ ಪತ್ತೆ</Text>
            </View>
            <View style={m.aiPill}>
              <MaterialCommunityIcons name="cpu-64-bit" size={13} color={C.primary} />
              <Text style={m.aiPillText}>On-device AI</Text>
            </View>
          </View>

          {/* ── Big Scan Hero ── */}
          <TouchableOpacity
            activeOpacity={0.94}
            onPress={() => setShowCamera(true)}
            disabled={!isModelLoaded}
            style={m.heroWrap}
          >
            <LinearGradient
              colors={['#2D6A4F', '#1B4332', '#0D2818']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={m.hero}
            >
              {/* Decorative orbits */}
              <View style={[m.heroOrbit, { width: 260, height: 260, right: -80, top: -80 }]} />
              <View style={[m.heroOrbit, { width: 180, height: 180, right: -40, top: -40, opacity: 0.4 }]} />

              <View style={m.heroBadge}>
                <Ionicons name="flash" size={12} color="#95D5B2" />
                <Text style={m.heroBadgeText}>Instant · Offline · Private</Text>
              </View>

              <Text style={m.heroTitle}>Detect crop{'\n'}diseases instantly</Text>
              <Text style={m.heroSub}>
                Point your camera at a leaf.{'\n'}Get treatment in seconds.
              </Text>

              <View style={m.heroFooter}>
                <View style={m.heroCircleBtn}>
                  <Ionicons name="camera" size={24} color="#1B4332" />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={m.heroCta}>Open Camera</Text>
                  <Text style={m.heroCtaSub}>Tap anywhere to start</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Quick Action Cards ── */}
          <View style={m.actionRow}>
            <ActionCard
              icon="images"
              iconLib="ion"
              label="From Gallery"
              subLabel="ಗ್ಯಾಲರಿಯಿಂದ"
              onPress={() => Alert.alert('Coming Soon', 'Gallery upload will be added shortly.')}
            />
            <ActionCard
              icon="book-open-variant"
              iconLib="mci"
              label="Disease Library"
              subLabel="38 ರೋಗಗಳು"
              onPress={() => Alert.alert('Coming Soon', 'Browse the full disease library.')}
            />
          </View>

          {/* ── How it works ── */}
          <View style={m.sectionHeader}>
            <View style={m.sectionAccent} />
            <Text style={m.sectionTitle}>How it works</Text>
          </View>
          <View style={m.stepsCard}>
            <Step index="1" title="Take a clear photo" sub="Fill the frame with one leaf" />
            <View style={m.stepDivider} />
            <Step index="2" title="AI analyses instantly" sub="MobileNetV2 · 38 disease classes" />
            <View style={m.stepDivider} />
            <Step index="3" title="Get treatment advice" sub="Organic & chemical options" last />
          </View>

          {/* ── Recent scan (if any) ── */}
          {diagnosis && capturedUri && (
            <>
              <View style={m.sectionHeader}>
                <View style={m.sectionAccent} />
                <Text style={m.sectionTitle}>Last Diagnosis</Text>
                <TouchableOpacity onPress={() => setShowResult(true)} activeOpacity={0.7}>
                  <Text style={m.viewAll}>View</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={m.lastCard}
                activeOpacity={0.9}
                onPress={() => setShowResult(true)}
              >
                <Image source={{ uri: capturedUri }} style={m.lastThumb} />
                <View style={{ flex: 1, marginLeft: 12 }}>
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
                <Ionicons name="chevron-forward" size={20} color={C.textLight} />
              </TouchableOpacity>
            </>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ── Bottom-Sheet Diagnosis Result ── */}
      <Modal visible={showResult} transparent animationType="none" onRequestClose={() => setShowResult(false)}>
        <TouchableOpacity
          style={m.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setShowResult(false)}
        />
        <Animated.View style={[m.sheet, { transform: [{ translateY: sheetSlide }] }]}>
          <View style={m.sheetHandle} />
          {diagnosis && capturedUri && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Leaf photo hero */}
              <View style={m.leafHeroWrap}>
                <Image source={{ uri: capturedUri }} style={m.leafHero} />
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.6)']}
                  style={m.leafHeroGradient}
                />
                <View style={m.leafHeroBadgeTL}>
                  <View style={[m.sevChip, { backgroundColor: sevColor(diagnosis.severity).bg }]}>
                    <Ionicons
                      name={diagnosis.severity === 'Low' ? 'checkmark-circle' : 'warning'}
                      size={12}
                      color={sevColor(diagnosis.severity).fg}
                    />
                    <Text style={[m.sevChipText, { color: sevColor(diagnosis.severity).fg }]}>
                      {sevColor(diagnosis.severity).label} Severity
                    </Text>
                  </View>
                </View>
                <View style={m.leafHeroTextBottom}>
                  <Text style={m.leafCrop}>{diagnosis.affected_crop}</Text>
                  <Text style={m.leafDisease}>{diagnosis.disease_name}</Text>
                  {!!diagnosis.kannada_name && (
                    <Text style={m.leafKn}>{diagnosis.kannada_name}</Text>
                  )}
                </View>
              </View>

              {/* Confidence + scientific name */}
              <View style={m.detailBlock}>
                {!!diagnosis.scientific_name && (
                  <Text style={m.sciName}>{diagnosis.scientific_name}</Text>
                )}
                <View style={m.confRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={m.confLabel}>AI Confidence</Text>
                    <ConfidenceGauge value={diagnosis.confidence} />
                  </View>
                  <View style={m.confValueBox}>
                    <Text style={m.confValue}>{diagnosis.confidence}</Text>
                    <Text style={m.confPct}>%</Text>
                  </View>
                </View>
              </View>

              {/* Treatment tabs */}
              {(diagnosis.organic_treatment || diagnosis.chemical_treatment) && (
                <>
                  <View style={m.tabRow}>
                    <TabButton
                      active={treatmentTab === 'organic'}
                      onPress={() => setTreatmentTab('organic')}
                      icon="leaf"
                      label="Organic"
                      subLabel="ಸಾವಯವ"
                    />
                    <TabButton
                      active={treatmentTab === 'chemical'}
                      onPress={() => setTreatmentTab('chemical')}
                      icon="flask"
                      label="Chemical"
                      subLabel="ರಾಸಾಯನಿಕ"
                    />
                  </View>

                  <View style={m.treatCard}>
                    {treatmentTab === 'organic' ? (
                      <TreatmentContent
                        color={C.primary}
                        title={diagnosis.organic_treatment ?? '—'}
                        dosage={diagnosis.organic_dosage}
                        empty={!diagnosis.organic_treatment}
                      />
                    ) : (
                      <TreatmentContent
                        color={C.amber}
                        title={diagnosis.chemical_treatment ?? '—'}
                        dosage={diagnosis.chemical_dosage}
                        empty={!diagnosis.chemical_treatment}
                      />
                    )}
                  </View>
                </>
              )}

              {/* Prevention */}
              {!!diagnosis.prevention && (
                <View style={m.prevCard}>
                  <View style={m.prevIconBox}>
                    <MaterialCommunityIcons name="shield-check" size={20} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={m.prevTitle}>Prevention · ತಡೆಗಟ್ಟುವಿಕೆ</Text>
                    <Text style={m.prevBody}>{diagnosis.prevention}</Text>
                  </View>
                </View>
              )}

              {/* Store recommendation */}
              {!!diagnosis.store_product && (
                <View style={m.storeCard}>
                  <FontAwesome5 name="store" size={16} color={C.primary} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={m.storeTitle}>Available at local agri-stores</Text>
                    <Text style={m.storeProduct}>{diagnosis.store_product}</Text>
                  </View>
                </View>
              )}

              {/* Action buttons */}
              <View style={m.sheetBtnRow}>
                <TouchableOpacity
                  style={[m.sheetBtnSecondary]}
                  onPress={() => {
                    setShowResult(false);
                    setTimeout(() => setShowCamera(true), 300);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="camera" size={16} color={C.primary} />
                  <Text style={m.sheetBtnSecondaryText}>Scan Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setShowResult(false)}
                  style={{ flex: 1 }}
                >
                  <LinearGradient
                    colors={[C.primary, C.primaryDark]}
                    style={m.sheetBtnPrimary}
                  >
                    <Text style={m.sheetBtnPrimaryText}>Got it</Text>
                    <Ionicons name="checkmark" size={18} color="#FFF" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </Modal>
    </View>
  );
}

// ── Helper Components ───────────────────────────────────────────────────────
function ActionCard({ icon, iconLib, label, subLabel, onPress }: any) {
  const Icon = iconLib === 'ion' ? Ionicons : MaterialCommunityIcons;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={m.actionCard}>
      <View style={m.actionIconBox}>
        <Icon name={icon} size={22} color={C.primary} />
      </View>
      <Text style={m.actionLabel}>{label}</Text>
      <Text style={m.actionSub}>{subLabel}</Text>
    </TouchableOpacity>
  );
}

function Step({ index, title, sub, last }: any) {
  return (
    <View style={m.stepRow}>
      <View style={m.stepNum}><Text style={m.stepNumText}>{index}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={m.stepTitle}>{title}</Text>
        <Text style={m.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

function TabButton({ active, onPress, icon, label, subLabel }: any) {
  return (
    <TouchableOpacity
      onPress={onPress} activeOpacity={0.85}
      style={[m.tabBtn, active && m.tabBtnActive]}
    >
      <Ionicons name={icon} size={16} color={active ? '#FFF' : C.textMuted} />
      <View style={{ marginLeft: 6 }}>
        <Text style={[m.tabBtnLabel, active && m.tabBtnLabelActive]}>{label}</Text>
        <Text style={[m.tabBtnSub, active && m.tabBtnSubActive]}>{subLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

function TreatmentContent({ color, title, dosage, empty }: any) {
  if (empty) return <Text style={m.treatEmpty}>Not applicable for this disease.</Text>;
  return (
    <View>
      <View style={[m.treatAccent, { backgroundColor: color }]} />
      <Text style={m.treatTitle}>{title}</Text>
      {!!dosage && <Text style={m.treatDosage}>Dosage: {dosage}</Text>}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },

  // Loading overlay
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(248,249,250,0.94)', zIndex: 999, justifyContent: 'center', alignItems: 'center' },
  loadingBox: { alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 32, paddingVertical: 28, borderRadius: 20, elevation: 8, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
  loadingText: { marginTop: 12, fontFamily: 'Inter_700Bold', fontSize: 15, color: C.textDark },
  loadingSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textMuted, marginTop: 4 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  hTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, color: C.textDark, letterSpacing: -0.5 },
  hTitleKn: { fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textMuted, marginTop: 2 },
  aiPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryPale, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#B7E4C7',
  },
  aiPillText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary },

  // Hero card
  heroWrap: {
    borderRadius: 24, overflow: 'hidden',
    shadowColor: C.primaryDark, shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28, shadowRadius: 20, elevation: 12,
  },
  hero: { padding: 22, minHeight: 240, justifyContent: 'space-between' },
  heroOrbit: {
    position: 'absolute',
    borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(149, 213, 178, 0.3)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, alignSelf: 'flex-start',
  },
  heroBadgeText: { color: '#95D5B2', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  heroTitle: { color: '#FFF', fontFamily: 'Inter_800ExtraBold', fontSize: 26, lineHeight: 32, marginTop: 12, letterSpacing: -0.5 },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 8 },
  heroFooter: {
    flexDirection: 'row', alignItems: 'center', marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  heroCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  heroCta: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  heroCtaSub: { color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },

  // Action row
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  actionCard: {
    flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  actionIconBox: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.primaryTint, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  actionLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textDark },
  actionSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textMuted, marginTop: 2 },

  // Section header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  sectionAccent: { width: 4, height: 18, borderRadius: 2, backgroundColor: C.primary, marginRight: 8 },
  sectionTitle: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16, color: C.textDark },
  viewAll: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.primary },

  // Steps card
  stepsCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 4,
    borderWidth: 1, borderColor: C.border,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  stepNum: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.primaryPale, alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  stepNumText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.primary },
  stepTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textDark },
  stepSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textMuted, marginTop: 2 },
  stepDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 14 },

  // Last diagnosis card
  lastCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  lastThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: C.primaryPale },
  lastCrop: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  lastDisease: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textDark, marginTop: 2 },
  lastMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  lastConf: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted },
  sevChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  sevChipText: { fontFamily: 'Inter_700Bold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 },

  // Camera UI
  camUI: { paddingHorizontal: 20, paddingTop: 12 },
  camTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  camCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  camTitleBox: { alignItems: 'center' },
  camTitle: { color: '#FFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  camTitleKn: { color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },
  camModelPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  camModelText: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  scanBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', marginTop: 16,
    backgroundColor: 'rgba(0,0,0,0.7)', borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.5)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  scanBannerText: { color: '#FFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  // Permission
  permSafe: { flex: 1, backgroundColor: C.bg },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primaryPale, alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, borderWidth: 3, borderColor: '#B7E4C7',
  },
  permTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.textDark },
  permSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  permBtnText: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 15 },

  // Bottom sheet
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: SCREEN_H * 0.9, paddingTop: 8,
  },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 6 },

  leafHeroWrap: { margin: 16, borderRadius: 20, overflow: 'hidden', height: 200, position: 'relative' },
  leafHero: { width: '100%', height: '100%' },
  leafHeroGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 140 },
  leafHeroBadgeTL: { position: 'absolute', top: 12, left: 12 },
  leafHeroTextBottom: { position: 'absolute', bottom: 14, left: 14, right: 14 },
  leafCrop: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 0.5 },
  leafDisease: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: '#FFF', marginTop: 2 },
  leafKn: { fontFamily: 'Inter_500Medium', fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 3 },

  detailBlock: { paddingHorizontal: 20, paddingBottom: 8 },
  sciName: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textMuted, fontStyle: 'italic', marginBottom: 12 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  confLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.textBody },
  confValueBox: { flexDirection: 'row', alignItems: 'flex-end' },
  confValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: C.textDark, letterSpacing: -0.5, lineHeight: 30 },
  confPct: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textMuted, marginLeft: 2, marginBottom: 4 },

  tabRow: { flexDirection: 'row', marginHorizontal: 20, marginTop: 16, gap: 8 },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 12, backgroundColor: '#F3F4F6',
    borderWidth: 1, borderColor: 'transparent',
  },
  tabBtnActive: { backgroundColor: C.primary, borderColor: C.primaryDark },
  tabBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textMuted },
  tabBtnLabelActive: { color: '#FFF' },
  tabBtnSub: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textLight, marginTop: 1 },
  tabBtnSubActive: { color: 'rgba(255,255,255,0.75)' },

  treatCard: {
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: '#FAFAFA', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  treatAccent: { position: 'absolute', top: 12, left: 0, width: 3, height: 24, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  treatTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textDark, paddingLeft: 10 },
  treatDosage: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textMuted, marginTop: 6, paddingLeft: 10 },
  treatEmpty: { fontFamily: 'Inter_400Regular', fontSize: 13, color: C.textLight, fontStyle: 'italic' },

  prevCard: {
    flexDirection: 'row', marginHorizontal: 20, marginTop: 16,
    backgroundColor: C.primaryTint, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  prevIconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.primaryPale, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  prevTitle: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.primaryDark },
  prevBody: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textBody, marginTop: 4, lineHeight: 17 },

  storeCard: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 12,
    backgroundColor: '#FFF', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  storeTitle: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  storeProduct: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textDark, marginTop: 2 },

  sheetBtnRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginTop: 20 },
  sheetBtnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 20, height: 52, borderRadius: 14,
    backgroundColor: C.primaryTint, borderWidth: 1, borderColor: '#B7E4C7',
  },
  sheetBtnSecondaryText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.primary },
  sheetBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 52, borderRadius: 14,
  },
  sheetBtnPrimaryText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#FFF' },
});
