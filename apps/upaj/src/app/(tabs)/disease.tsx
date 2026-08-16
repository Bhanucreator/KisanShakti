import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Image, Alert, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../../constants/theme';
import { useDiseaseDetection, InferenceResult } from '../../hooks/use-disease-detection';

// ── Severity helpers ──────────────────────────────────────────────────────────

type SeverityLevel = 'Low' | 'Medium' | 'High' | 'Critical';

function severityBg(severity: string): string {
  switch (severity as SeverityLevel) {
    case 'Critical':
    case 'High':   return COLORS.accentRedBg;
    case 'Medium': return COLORS.accentAmberBg;
    default:       return COLORS.primaryLightBg;
  }
}

function severityColor(severity: string): string {
  switch (severity as SeverityLevel) {
    case 'Critical':
    case 'High':   return COLORS.accentRed;
    case 'Medium': return COLORS.accentAmber;
    default:       return COLORS.primary;
  }
}

// ── Crop-frame overlay component ──────────────────────────────────────────────

function CropFrame() {
  const FRAME = 260;
  const CORNER = 22;
  const BORDER = 3;
  const color = COLORS.primaryBright;

  const cornerStyle = (pos: object) => ({
    position: 'absolute' as const,
    width: CORNER,
    height: CORNER,
    borderColor: color,
    ...pos,
  });

  return (
    <View style={[StyleSheet.absoluteFill, styles.cropFrameContainer]} pointerEvents="none">
      <View style={{ width: FRAME, height: FRAME, position: 'relative' }}>
        {/* Semi-transparent overlay outside the frame */}
        <View style={[StyleSheet.absoluteFill, styles.cropFrameOuterBorder]} />

        {/* Top-left corner */}
        <View style={[cornerStyle({ top: 0, left: 0, borderTopWidth: BORDER, borderLeftWidth: BORDER })]} />
        {/* Top-right corner */}
        <View style={[cornerStyle({ top: 0, right: 0, borderTopWidth: BORDER, borderRightWidth: BORDER })]} />
        {/* Bottom-left corner */}
        <View style={[cornerStyle({ bottom: 0, left: 0, borderBottomWidth: BORDER, borderLeftWidth: BORDER })]} />
        {/* Bottom-right corner */}
        <View style={[cornerStyle({ bottom: 0, right: 0, borderBottomWidth: BORDER, borderRightWidth: BORDER })]} />

        {/* Thin full border */}
        <View style={{
          ...StyleSheet.absoluteFillObject,
          borderWidth: 1,
          borderColor: `${color}55`,
          borderRadius: 4,
        }} />
      </View>
      <Text style={styles.cropFrameHint}>Position leaf inside the frame</Text>
    </View>
  );
}

// ── Pulsing snap button ───────────────────────────────────────────────────────

function SnapButton({ onPress, isRunning }: { onPress: () => void; isRunning: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isRunning) {
      pulseAnim.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.18, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0,  duration: 500, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isRunning, pulseAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <TouchableOpacity
        style={[styles.snapBtn, isRunning && styles.snapBtnRunning]}
        onPress={onPress}
        activeOpacity={0.8}
        disabled={isRunning}
      >
        {isRunning ? (
          <ActivityIndicator color="#FFF" size="small" />
        ) : (
          <View style={styles.snapInner} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DiseaseScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera]     = useState(false);
  const [capturedUri, setCapturedUri]   = useState<string | null>(null);
  const [diagnosis, setDiagnosis]       = useState<InferenceResult | null>(null);

  const cameraRef = useRef<CameraView>(null);

  const { isModelLoaded, isRunning, runInference } = useDiseaseDetection();

  // ── Snap handler ────────────────────────────────────────────────────────────

  async function handleSnap() {
    if (!cameraRef.current || isRunning) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return;

      setCapturedUri(photo.uri);

      const result = await runInference(photo.uri);
      if (result) {
        setDiagnosis(result);
      } else {
        Alert.alert('Detection Failed', 'Could not analyse the image. Please try again.');
      }
      setShowCamera(false);
    } catch (e) {
      console.error('[DiseaseScreen] snap error:', e);
      Alert.alert('Error', 'Failed to capture or analyse photo.');
    }
  }

  // ── Camera view ─────────────────────────────────────────────────────────────

  if (showCamera) {
    if (!permission?.granted) {
      return (
        <SafeAreaView style={styles.safe}>
          <View style={styles.permContainer}>
            <Ionicons name="camera-outline" size={48} color={COLORS.primary} />
            <Text style={styles.permTitle}>Camera Access Needed</Text>
            <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
              <Text style={styles.grantBtnText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing={'back' as CameraType}>

          {/* Crop-frame overlay */}
          <CropFrame />

          <SafeAreaView style={styles.cameraUI}>
            {/* Close button */}
            <TouchableOpacity
              style={styles.closeCamBtn}
              onPress={() => setShowCamera(false)}
            >
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>

            {/* Scanning overlay while running */}
            {isRunning && (
              <View style={styles.scanningBanner}>
                <ActivityIndicator color={COLORS.primaryBright} size="small" />
                <Text style={styles.scanningText}>Analysing with AI…</Text>
              </View>
            )}

            {/* Snap button */}
            <SnapButton onPress={handleSnap} isRunning={isRunning} />
          </SafeAreaView>
        </CameraView>
      </View>
    );
  }

  // ── Main scroll view ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      {/* Model loading overlay */}
      {!isModelLoaded && (
        <View style={styles.modelLoadingOverlay}>
          <ActivityIndicator color={COLORS.primary} size="large" />
          <Text style={styles.modelLoadingText}>Loading AI Model…</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textDark} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.title}>Disease Detection</Text>
            <Text style={styles.subtitle}>Identify and protect your crops</Text>
          </View>
        </View>

        {/* ── Photo Upload Hero Box ── */}
        <View style={styles.uploadCard}>
          <TouchableOpacity
            style={styles.camCircle}
            onPress={() => setShowCamera(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="camera" size={32} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.uploadHint}>Tap to take photo or upload from gallery</Text>

          <View style={styles.uploadBtnRow}>
            <TouchableOpacity
              style={styles.takePhotoBtn}
              onPress={() => setShowCamera(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="camera" size={16} color={COLORS.textWhite} />
              <Text style={styles.takePhotoText}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.uploadFileBtn}
              onPress={() => Alert.alert('Gallery', 'Select photo from gallery')}
              activeOpacity={0.8}
            >
              <Ionicons name="cloud-upload-outline" size={16} color={COLORS.primary} />
              <Text style={styles.uploadFileText}>Upload</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Diagnosis result or empty state ── */}
        {diagnosis === null ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconRing}>
              <MaterialCommunityIcons name="leaf" size={36} color={COLORS.primary} />
            </View>
            <Text style={styles.emptyTitle}>No Diagnosis Yet</Text>
            <Text style={styles.emptySub}>
              Point your camera at a crop leaf and tap "Take Photo" to instantly detect diseases using on-device AI.
            </Text>
            <View style={styles.emptyHintRow}>
              <View style={styles.emptyHintChip}>
                <Ionicons name="flash" size={12} color={COLORS.primary} />
                <Text style={styles.emptyHintText}>Works Offline</Text>
              </View>
              <View style={styles.emptyHintChip}>
                <Ionicons name="time-outline" size={12} color={COLORS.primary} />
                <Text style={styles.emptyHintText}>Results in 2s</Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* ── Result header ── */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Diagnosis Result</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => { setDiagnosis(null); setCapturedUri(null); }}>
                <Text style={styles.viewHistoryText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {/* ── Diagnosis card ── */}
            <View style={[styles.diagnosisCard, isRunning && styles.diagnosisCardRunning]}>
              {isRunning && (
                <View style={styles.inferenceSpinnerOverlay}>
                  <ActivityIndicator color={COLORS.primary} size="large" />
                  <Text style={styles.inferenceSpinnerText}>Analysing…</Text>
                </View>
              )}

              <View style={styles.diagLeft}>
                <Text style={styles.diseaseName}>{diagnosis.disease_name}</Text>
                {diagnosis.scientific_name ? (
                  <Text style={styles.scientificName}>({diagnosis.scientific_name})</Text>
                ) : null}
                {diagnosis.kannada_name ? (
                  <Text style={styles.kannadaName}>{diagnosis.kannada_name}</Text>
                ) : null}

                <View style={styles.badgeRow}>
                  <View style={[styles.pillBadge, { backgroundColor: COLORS.primaryLightBg }]}>
                    <Text style={styles.pillLabel}>Confidence</Text>
                    <Text style={[styles.pillValue, { color: COLORS.primary }]}>
                      {diagnosis.confidence}%
                    </Text>
                  </View>

                  <View style={[styles.pillBadge, { backgroundColor: severityBg(diagnosis.severity) }]}>
                    <Text style={styles.pillLabel}>Severity</Text>
                    <Text style={[styles.pillValue, { color: severityColor(diagnosis.severity) }]}>
                      {diagnosis.severity}
                    </Text>
                  </View>

                  <View style={styles.affectedBlock}>
                    <Text style={styles.pillLabel}>Affected Crop</Text>
                    <Text style={styles.affectedVal}>{diagnosis.affected_crop}</Text>
                  </View>
                </View>
              </View>

              {/* Captured leaf image or fallback */}
              <View style={styles.leafImgContainer}>
                {capturedUri ? (
                  <Image source={{ uri: capturedUri }} style={styles.leafImg} />
                ) : (
                  <Image
                    source={{ uri: 'https://images.unsplash.com/photo-1592417817098-8f3d6ef23a23?w=300&q=80' }}
                    style={styles.leafImg}
                  />
                )}
              </View>
            </View>

            {/* ── Treatment section ── */}
            <Text style={[styles.sectionTitle, { marginTop: SPACING.xl, marginBottom: SPACING.sm }]}>
              Treatment
            </Text>

            {diagnosis.organic_treatment ? (
              <View style={styles.treatmentCard}>
                <View style={styles.checkIconCircle}>
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.treatmentTitle}>
                    Organic: {diagnosis.organic_treatment}
                  </Text>
                  {diagnosis.organic_dosage ? (
                    <Text style={styles.treatmentDosage}>{diagnosis.organic_dosage}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {diagnosis.chemical_treatment ? (
              <View style={styles.treatmentCard}>
                <View style={styles.checkIconCircle}>
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.treatmentTitle}>
                    Chemical: {diagnosis.chemical_treatment}
                  </Text>
                  {diagnosis.chemical_dosage ? (
                    <Text style={styles.treatmentDosage}>{diagnosis.chemical_dosage}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Prevention tip */}
            {diagnosis.prevention ? (
              <View style={[styles.treatmentCard, { borderColor: '#C8E6C9' }]}>
                <View style={styles.checkIconCircle}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.primaryLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.treatmentTitle}>Prevention</Text>
                  <Text style={styles.treatmentDosage}>{diagnosis.prevention}</Text>
                </View>
              </View>
            ) : null}

            {/* ── Nearby store card ── */}
            {diagnosis.store_product ? (
              <View style={styles.storeCard}>
                <View style={styles.storeIconBg}>
                  <FontAwesome5 name="store" size={16} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeHeader}>Recommended Product</Text>
                  <Text style={styles.storeName}>{diagnosis.store_product}</Text>
                  <Text style={styles.storeDist}>Available at local agri stores</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </View>
            ) : (
              /* Show a generic healthy-plant store card for "healthy" predictions */
              <View style={styles.storeCard}>
                <View style={styles.storeIconBg}>
                  <FontAwesome5 name="store" size={16} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeHeader}>Buy in Nearby Store</Text>
                  <Text style={styles.storeName}>Raju Agro Store, Kolar</Text>
                  <Text style={styles.storeDist}>2.3 km away · In stock</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </View>
            )}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 48 },

  // Model loading overlay
  modelLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    backgroundColor: 'rgba(255,255,255,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  modelLoadingText: {
    fontSize: FONT_SIZES.body,
    fontWeight: '600',
    color: COLORS.primary,
  },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.lg },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Upload Card
  uploadCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.xxl, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.xl,
    ...SHADOWS.card,
  },
  camCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#E8F5E9', borderWidth: 2, borderColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  uploadHint: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500', marginBottom: 16 },
  uploadBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  takePhotoBtn: {
    flex: 1, backgroundColor: COLORS.primary, borderRadius: RADII.pill,
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  takePhotoText: { color: COLORS.textWhite, fontWeight: '700', fontSize: 14 },
  uploadFileBtn: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.pill,
    paddingVertical: 12, borderWidth: 1.5, borderColor: COLORS.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  uploadFileText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },

  // Section Header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: SPACING.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  viewHistoryText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Diagnosis Card
  diagnosisCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', gap: 12, marginBottom: SPACING.lg,
    ...SHADOWS.card,
    overflow: 'hidden',
  },
  diagnosisCardRunning: { opacity: 0.6 },
  diagLeft: { flex: 1 },
  diseaseName: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  scientificName: { fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic', marginBottom: 4 },
  kannadaName: { fontSize: 12, color: COLORS.primaryLight, fontWeight: '600', marginBottom: 8 },

  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pillBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADII.sm },
  pillLabel: { fontSize: 9, color: COLORS.textMuted },
  pillValue: { fontSize: 12, fontWeight: '800', marginTop: 1 },
  affectedBlock: { paddingHorizontal: 4, paddingVertical: 4 },
  affectedVal: { fontSize: 12, fontWeight: '700', color: COLORS.textDark, marginTop: 1 },
  leafImgContainer: { width: 80, height: 80, borderRadius: RADII.md, overflow: 'hidden' },
  leafImg: { width: '100%', height: '100%' },

  // Inference spinner overlay (inside card)
  inferenceSpinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  inferenceSpinnerText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Treatment
  treatmentCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8,
    ...SHADOWS.card,
  },
  checkIconCircle: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  treatmentTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  treatmentDosage: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },

  // Store Card
  storeCard: {
    backgroundColor: '#F4F9F5', borderRadius: RADII.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: '#C8E6C9',
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: SPACING.md,
    ...SHADOWS.card,
  },
  storeIconBg: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center',
  },
  storeHeader: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  storeName: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark, marginTop: 1 },
  storeDist: { fontSize: 11, color: COLORS.primary, marginTop: 2 },

  // Empty state
  emptyState: {
    alignItems: 'center', paddingVertical: SPACING.xxl, paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
  },
  emptyIconRing: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#E8F5E9', borderWidth: 2, borderColor: COLORS.primaryBright,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginBottom: 8 },
  emptySub: {
    fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  emptyHintRow: { flexDirection: 'row', gap: 10 },
  emptyHintChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E8F5E9', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADII.pill,
  },
  emptyHintText: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },

  // Camera permissions
  permContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  permTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textDark, marginVertical: 12 },
  grantBtn: {
    backgroundColor: COLORS.primary, paddingHorizontal: 24,
    paddingVertical: 12, borderRadius: RADII.pill,
  },
  grantBtnText: { color: COLORS.textWhite, fontWeight: '700' },

  // Camera UI
  cameraUI: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
    alignItems: 'center',
  },
  closeCamBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  scanningBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: RADII.pill,
  },
  scanningText: { color: '#FFF', fontWeight: '600', fontSize: 13 },

  // Snap button
  snapBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
  },
  snapBtnRunning: { borderColor: COLORS.primaryBright },
  snapInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary },

  // Crop frame
  cropFrameContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  cropFrameOuterBorder: {
    borderWidth: 2,
    borderColor: COLORS.primaryBright,
    borderRadius: 4,
  },
  cropFrameHint: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
});
