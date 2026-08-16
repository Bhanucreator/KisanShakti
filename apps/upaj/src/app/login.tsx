import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Easing,
  Keyboard, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
  Dimensions, SafeAreaView, StatusBar, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeGradient as LinearGradient, SafeBlur as BlurView } from '../components/safe-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/use-auth';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.183.6.220:8000';

type Step = 'phone' | 'otp';
const OTP_LENGTH = 6;
const RESEND_COUNTDOWN = 30;

export default function LoginScreen() {
  const auth = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [phoneSending, setPhoneSending] = useState(false);

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [otpError, setOtpError] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COUNTDOWN);
  const [isNewUser, setIsNewUser] = useState(false);
  const [farmerName, setFarmerName] = useState('');

  const otpRefs = useRef<Array<TextInput | null>>(Array(OTP_LENGTH).fill(null));
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const cardTranslateY = useRef(new Animated.Value(80)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const heroFade = useRef(new Animated.Value(0)).current;
  const orbitRotate = useRef(new Animated.Value(0)).current;
  const leafFloat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroFade, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(cardTranslateY, { toValue: 0, damping: 20, stiffness: 140, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.timing(orbitRotate, { toValue: 1, duration: 24000, easing: Easing.linear, useNativeDriver: true })
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(leafFloat, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(leafFloat, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  const startCountdown = useCallback(() => {
    setCountdown(RESEND_COUNTDOWN);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const fullPhone = `+91${phoneNumber}`;
  const formatCountdown = () => {
    const m = Math.floor(countdown / 60);
    const s = countdown % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSendOtp = async () => {
    setPhoneError('');
    if (phoneNumber.length !== 10) {
      setPhoneError('Please enter a valid 10-digit mobile number');
      return;
    }
    Keyboard.dismiss();
    setPhoneSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, role: 'farmer' }),
      });
      const data = await res.json();
      if (!res.ok) { setPhoneError(data?.detail ?? 'Failed to send OTP'); return; }
      startCountdown();
      setOtp(Array(OTP_LENGTH).fill(''));
      setOtpError('');
      setStep('otp');
      if (data.dev_otp) {
        Alert.alert('🔑 Dev OTP', `Your code: ${data.dev_otp}`, [
          { text: 'Auto-fill', onPress: () => setOtp(data.dev_otp.split('')) }
        ]);
      } else {
        setTimeout(() => otpRefs.current[0]?.focus(), 350);
      }
    } catch {
      setPhoneError(`Cannot reach ${API_BASE}\nCheck backend & Wi-Fi.`);
    } finally {
      setPhoneSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError('');
    if (otp.join('').length < OTP_LENGTH) { setOtpError('Enter the complete 6-digit OTP'); return; }
    if (isNewUser && farmerName.trim().length < 2) { setOtpError('Please enter your full name'); return; }
    Keyboard.dismiss();
    setOtpVerifying(true);
    try {
      const body: Record<string, string> = { phone: fullPhone, otp: otp.join(''), role: 'farmer' };
      if (farmerName.trim()) body.name = farmerName.trim();
      const res = await fetch(`${API_BASE}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setOtpError(data?.detail ?? 'Invalid OTP'); return; }
      if (data.is_new_user && !isNewUser) { setIsNewUser(true); setOtpError(''); setOtpVerifying(false); return; }
      await auth.signIn(data.access_token, String(data.user_id), data.name ?? farmerName.trim(), fullPhone);
      router.replace('/(tabs)');
    } catch { setOtpError('Network error. Please try again.'); }
    finally { setOtpVerifying(false); }
  };

  const handleOtpChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otp]; next[index] = digit; setOtp(next);
    if (digit && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const handleOtpKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      const next = [...otp]; next[index - 1] = ''; setOtp(next);
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    setOtpError('');
    setPhoneSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/send-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, role: 'farmer' }),
      });
      const data = await res.json();
      if (!res.ok) { setOtpError(data?.detail ?? 'Failed to resend'); return; }
      startCountdown();
      if (data.dev_otp) {
        Alert.alert('🔑 Dev OTP', `Code: ${data.dev_otp}`, [
          { text: 'Auto-fill', onPress: () => setOtp(data.dev_otp.split('')) }
        ]);
      }
    } catch { setOtpError('Network error'); }
    finally { setPhoneSending(false); }
  };

  const goBackToPhone = () => {
    setStep('phone'); setOtp(Array(OTP_LENGTH).fill('')); setOtpError('');
    setIsNewUser(false); setFarmerName('');
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  const orbitSpin = orbitRotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const leafOffset = leafFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0A1F14" />

      {/* Full-screen gradient backdrop */}
      <LinearGradient
        colors={['#0A1F14', '#0D2818', '#1B4332']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Ambient orbital rings */}
      <Animated.View
        style={[s.orbitContainer, { transform: [{ rotate: orbitSpin }] }]}
        pointerEvents="none"
      >
        <View style={[s.orbit, { width: 340, height: 340, borderColor: 'rgba(82, 183, 136, 0.15)' }]} />
        <View style={[s.orbit, { width: 260, height: 260, borderColor: 'rgba(82, 183, 136, 0.22)' }]} />
        <View style={[s.orbit, { width: 180, height: 180, borderColor: 'rgba(82, 183, 136, 0.30)' }]} />
        <View style={[s.orbitDot, { top: 0, backgroundColor: '#52B788' }]} />
        <View style={[s.orbitDot, { top: 40, right: 30, backgroundColor: '#95D5B2', width: 6, height: 6 }]} />
      </Animated.View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ── Hero Brand Section ─────────────────────────────────── */}
          <SafeAreaView style={s.heroWrap}>
            <Animated.View style={{ opacity: heroFade }}>
              <View style={s.brandRow}>
                <Animated.Text style={[s.brandLeaf, { transform: [{ translateY: leafOffset }] }]}>
                  🌿
                </Animated.Text>
                <View>
                  <Text style={s.brandName}>KisanShakti</Text>
                  <Text style={s.brandTag}>ಕಿಸಾನ್ ಶಕ್ತಿ</Text>
                </View>
              </View>
              <View style={s.divider} />
              <Text style={s.heroTitle}>
                Smart farming{'\n'}for smart farmers
              </Text>
              <Text style={s.heroSubtitle}>
                ಸ್ಮಾರ್ಟ್ ರೈತರಿಗಾಗಿ ಸ್ಮಾರ್ಟ್ ಕೃಷಿ
              </Text>

              <View style={s.badgeRow}>
                <FeatureBadge icon="scan" label="AI Disease Detection" />
                <FeatureBadge icon="pulse" label="Live Market Prices" />
              </View>
            </Animated.View>
          </SafeAreaView>

          {/* ── Glassmorphism Card ─────────────────────────────────── */}
          <Animated.View
            style={[s.cardOuter, {
              opacity: cardOpacity,
              transform: [{ translateY: cardTranslateY }]
            }]}
          >
            <BlurView intensity={Platform.OS === 'ios' ? 40 : 100} tint="light" style={s.card}>
              {step === 'phone' ? (
                <PhoneStage
                  phoneNumber={phoneNumber} setPhoneNumber={setPhoneNumber}
                  phoneError={phoneError} sending={phoneSending} onSend={handleSendOtp}
                />
              ) : (
                <OtpStage
                  phone={phoneNumber} otp={otp} focusedIndex={focusedIndex}
                  setFocusedIndex={setFocusedIndex} otpRefs={otpRefs}
                  otpError={otpError} verifying={otpVerifying} countdown={countdown}
                  isNewUser={isNewUser} farmerName={farmerName} setFarmerName={setFarmerName}
                  formatCountdown={formatCountdown} onOtpChange={handleOtpChange}
                  onOtpKeyPress={handleOtpKeyPress} onVerify={handleVerifyOtp}
                  onResend={handleResend} onBack={goBackToPhone}
                />
              )}
            </BlurView>
          </Animated.View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Feature Badge ─────────────────────────────────────────────────────────────
function FeatureBadge({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={s.featureBadge}>
      <Ionicons name={icon} size={14} color="#95D5B2" />
      <Text style={s.featureBadgeText}>{label}</Text>
    </View>
  );
}

// ── Phone Stage ────────────────────────────────────────────────────────────────
function PhoneStage({ phoneNumber, setPhoneNumber, phoneError, sending, onSend }: any) {
  return (
    <View>
      <View style={s.stageHeader}>
        <View>
          <Text style={s.stageTitle}>Welcome</Text>
          <Text style={s.stageTitleKn}>ಸ್ವಾಗತ</Text>
        </View>
        <View style={s.stepIndicator}>
          <View style={[s.stepDot, s.stepDotActive]} />
          <View style={s.stepDot} />
        </View>
      </View>
      <Text style={s.stageSubtitle}>Enter your mobile number to continue</Text>

      <Text style={s.fieldLabel}>Mobile Number · ಮೊಬೈಲ್ ಸಂಖ್ಯೆ</Text>
      <View style={[s.phoneRow, phoneError && s.inputWrapError]}>
        <View style={s.flagBox}>
          <Text style={s.flagText}>🇮🇳</Text>
          <Text style={s.dialCode}>+91</Text>
        </View>
        <TextInput
          style={s.phoneInput}
          placeholder="98765 43210"
          placeholderTextColor="#9CA3AF"
          keyboardType="number-pad"
          maxLength={10}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          returnKeyType="done"
          onSubmitEditing={onSend}
          autoFocus
        />
      </View>

      {!!phoneError && (
        <View style={s.errorBox}>
          <Ionicons name="alert-circle" size={14} color="#DC2626" />
          <Text style={s.errorText}>{phoneError}</Text>
        </View>
      )}

      <TouchableOpacity onPress={onSend} disabled={sending} activeOpacity={0.9} style={{ marginTop: 24 }}>
        <LinearGradient
          colors={sending ? ['#6B7280', '#4B5563'] : ['#2D6A4F', '#1B4332']}
          style={s.btn}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          {sending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={s.btnText}>Get OTP</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFF" />
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>

      <Text style={s.termsText}>
        By continuing, you agree to our{' '}
        <Text style={s.termsLink}>Terms</Text> and{' '}
        <Text style={s.termsLink}>Privacy Policy</Text>
      </Text>
    </View>
  );
}

// ── OTP Stage ──────────────────────────────────────────────────────────────────
function OtpStage({
  phone, otp, focusedIndex, setFocusedIndex, otpRefs, otpError,
  verifying, countdown, isNewUser, farmerName, setFarmerName,
  formatCountdown, onOtpChange, onOtpKeyPress, onVerify, onResend, onBack,
}: any) {
  return (
    <View>
      <View style={s.stageHeader}>
        <TouchableOpacity style={s.backBtn} onPress={onBack} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#1B4332" />
        </TouchableOpacity>
        <View style={s.stepIndicator}>
          <View style={s.stepDot} />
          <View style={[s.stepDot, s.stepDotActive]} />
        </View>
      </View>

      <Text style={s.stageTitle}>Verify OTP</Text>
      <Text style={s.stageTitleKn}>OTP ಪರಿಶೀಲಿಸಿ</Text>
      <Text style={s.stageSubtitle}>
        Sent to <Text style={{ fontWeight: '700', color: '#1B4332' }}>+91 {phone}</Text>
      </Text>

      <View style={s.otpRow}>
        {otp.map((digit: string, index: number) => (
          <TextInput
            key={index}
            ref={(ref: any) => { otpRefs.current[index] = ref; }}
            style={[
              s.otpBox,
              focusedIndex === index && s.otpBoxFocused,
              digit && s.otpBoxFilled,
            ]}
            value={digit}
            onChangeText={(t) => onOtpChange(t, index)}
            onKeyPress={({ nativeEvent }: any) => onOtpKeyPress(nativeEvent.key, index)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex(null)}
            keyboardType="number-pad"
            maxLength={1}
            textAlign="center"
            textContentType="oneTimeCode"
            selectTextOnFocus
          />
        ))}
      </View>

      {!!otpError && (
        <View style={s.errorBox}>
          <Ionicons name="alert-circle" size={14} color="#DC2626" />
          <Text style={s.errorText}>{otpError}</Text>
        </View>
      )}

      <View style={s.resendRow}>
        <Text style={s.resendPrefix}>Didn't receive it? </Text>
        {countdown > 0 ? (
          <Text style={s.resendTimer}>Resend in {formatCountdown()}</Text>
        ) : (
          <TouchableOpacity onPress={onResend} activeOpacity={0.7}>
            <Text style={s.resendLink}>Resend OTP</Text>
          </TouchableOpacity>
        )}
      </View>

      {isNewUser && (
        <View style={s.nameWrapper}>
          <Text style={s.fieldLabel}>Your name · ನಿಮ್ಮ ಹೆಸರು</Text>
          <TextInput
            style={s.nameInput}
            placeholder="Enter your full name"
            placeholderTextColor="#9CA3AF"
            value={farmerName}
            onChangeText={setFarmerName}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>
      )}

      <TouchableOpacity onPress={onVerify} disabled={verifying} activeOpacity={0.9} style={{ marginTop: 24 }}>
        <LinearGradient
          colors={verifying ? ['#6B7280', '#4B5563'] : ['#2D6A4F', '#1B4332']}
          style={s.btn}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          {verifying ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={s.btnText}>Verify &amp; Continue</Text>
              <Ionicons name="checkmark-circle" size={18} color="#FFF" />
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>

      <View style={{ height: 100 }} />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1F14' },
  scrollContent: { flexGrow: 1 },

  // Orbital background
  orbitContainer: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.05,
    right: -80,
    width: 340,
    height: 340,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: { position: 'absolute', borderRadius: 9999, borderWidth: 1 },
  orbitDot: {
    position: 'absolute',
    width: 8, height: 8,
    borderRadius: 4,
    shadowColor: '#52B788',
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },

  // Hero
  heroWrap: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 32,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  brandLeaf: { fontSize: 30 },
  brandName: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  brandTag: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },
  divider: {
    width: 32, height: 3, borderRadius: 2,
    backgroundColor: '#52B788',
    marginTop: 22, marginBottom: 12,
  },
  heroTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 24,
    color: '#FFFFFF',
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 5,
  },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 20, flexWrap: 'wrap' },
  featureBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(82, 183, 136, 0.15)',
    borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.3)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  featureBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#95D5B2',
  },

  // Card
  cardOuter: {
    marginHorizontal: 20,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
    elevation: 20,
  },
  card: {
    padding: 26,
    backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },

  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  stageTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    color: '#111827',
    letterSpacing: -0.3,
  },
  stageTitleKn: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#6B7A99',
    marginTop: 2,
  },
  stageSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: '#6B7A99',
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 20,
  },

  stepIndicator: { flexDirection: 'row', gap: 5, marginTop: 4 },
  stepDot: { width: 20, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },
  stepDotActive: { backgroundColor: '#1B4332', width: 28 },

  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#4B5563',
    marginBottom: 8,
    letterSpacing: 0.3,
  },

  phoneRow: {
    flexDirection: 'row',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  inputWrapError: { borderColor: '#DC2626' },
  flagBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0FDF4', paddingHorizontal: 14, gap: 8,
    borderRightWidth: 1, borderRightColor: '#E5E7EB',
  },
  flagText: { fontSize: 18 },
  dialCode: {
    fontFamily: 'Inter_700Bold', fontSize: 15, color: '#1B4332',
  },
  phoneInput: {
    flex: 1, height: 54, paddingHorizontal: 14,
    fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#111827',
    letterSpacing: 0.5,
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, paddingHorizontal: 4,
  },
  errorText: {
    fontFamily: 'Inter_500Medium', fontSize: 12, color: '#DC2626',
    flex: 1, lineHeight: 16,
  },

  btn: {
    height: 56, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: '#1B4332',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12,
    elevation: 8,
  },
  btnText: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  termsText: {
    fontFamily: 'Inter_400Regular', fontSize: 11.5, color: '#9CA3AF',
    textAlign: 'center', marginTop: 20, lineHeight: 17,
  },
  termsLink: { color: '#1B4332', fontFamily: 'Inter_700Bold' },

  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },

  otpRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 8, marginBottom: 4,
  },
  otpBox: {
    width: 46, height: 58, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: '#111827',
  },
  otpBoxFocused: {
    borderColor: '#1B4332', borderWidth: 2,
    backgroundColor: '#F0FDF4',
    shadowColor: '#1B4332',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 3,
  },
  otpBoxFilled: { borderColor: '#2D6A4F', backgroundColor: '#F0FDF4' },

  resendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
  resendPrefix: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#6B7A99' },
  resendTimer: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#9CA3AF' },
  resendLink: { fontFamily: 'Inter_700Bold', fontSize: 13, color: '#1B4332' },

  nameWrapper: { marginTop: 20 },
  nameInput: {
    height: 52, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14,
    paddingHorizontal: 14, fontFamily: 'Inter_500Medium', fontSize: 15,
    color: '#111827', backgroundColor: '#FFFFFF',
  },
});
