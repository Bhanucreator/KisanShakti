import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRef, useState, useCallback, useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useAuth } from '../hooks/use-auth';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const API_BASE = 'http://10.0.2.2:8000';
const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

const BUSINESS_TYPES = [
  { label: 'Kirana Store 🏪', value: 'kirana' },
  { label: 'Restaurant 🍽️',  value: 'restaurant' },
  { label: 'Wholesaler 🏭',   value: 'wholesaler' },
  { label: 'Canteen 🥘',      value: 'canteen' },
];

type Stage = 'phone' | 'otp' | 'profile';

export default function LoginScreen() {
  const { signIn } = useAuth();

  // ── Stage state ─────────────────────────────────────────────────────────────
  const [stage, setStage]             = useState<Stage>('phone');
  const [isNewUser, setIsNewUser]     = useState(false);

  // ── Phone stage ──────────────────────────────────────────────────────────────
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneBusy, setPhoneBusy]     = useState(false);

  // ── OTP stage ────────────────────────────────────────────────────────────────
  const [otp, setOtp]                 = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpBusy, setOtpBusy]         = useState(false);
  const [countdown, setCountdown]     = useState(RESEND_SECONDS);
  const [canResend, setCanResend]     = useState(false);
  const otpRefs                       = useRef<(TextInput | null)[]>([]);
  const timerRef                      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Profile stage ────────────────────────────────────────────────────────────
  const [shopName, setShopName]       = useState('');
  const [shopType, setShopType]       = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  // ── Animation ─────────────────────────────────────────────────────────────────
  const cardY    = useSharedValue(SCREEN_HEIGHT);
  const cardOpac = useSharedValue(0);
  const logoScale = useSharedValue(0.85);
  const logoOpac  = useSharedValue(0);

  useEffect(() => {
    logoScale.value = withSpring(1, { damping: 14, stiffness: 90 });
    logoOpac.value  = withTiming(1, { duration: 600 });
    cardY.value     = withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) });
    cardOpac.value  = withTiming(1, { duration: 500 });
  }, []);

  const animLogo = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpac.value,
  }));

  const animCard = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOpac.value,
  }));

  // ── Countdown timer ───────────────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    setCountdown(RESEND_SECONDS);
    setCanResend(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const transitionToOtp = useCallback(() => {
    cardY.value    = SCREEN_HEIGHT;
    cardOpac.value = 0;
    setStage('otp');
    startCountdown();
    setTimeout(() => {
      cardY.value    = withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) });
      cardOpac.value = withTiming(1, { duration: 400 });
    }, 50);
  }, [startCountdown]);

  const transitionToProfile = useCallback(() => {
    cardY.value    = SCREEN_HEIGHT;
    cardOpac.value = 0;
    setStage('profile');
    setTimeout(() => {
      cardY.value    = withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) });
      cardOpac.value = withTiming(1, { duration: 400 });
    }, 50);
  }, []);

  // ── Send OTP ──────────────────────────────────────────────────────────────────
  const handleSendOtp = useCallback(async () => {
    const digits = phoneNumber.trim();
    if (digits.length !== 10 || !/^\d{10}$/.test(digits)) {
      Alert.alert('Invalid number', 'Please enter a valid 10-digit mobile number.');
      return;
    }

    setPhoneBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+91' + digits, role: 'buyer' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'Failed to send OTP');
      setIsNewUser(data?.is_new_user ?? false);
      transitionToOtp();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not send OTP. Try again.');
    } finally {
      setPhoneBusy(false);
    }
  }, [phoneNumber, transitionToOtp]);

  // ── Verify OTP ────────────────────────────────────────────────────────────────
  const handleVerifyOtp = useCallback(async () => {
    const otpString = otp.join('');
    if (otpString.length !== OTP_LENGTH) {
      Alert.alert('Incomplete OTP', 'Please enter all 6 digits.');
      return;
    }

    setOtpBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '+91' + phoneNumber,
          otp: otpString,
          role: 'buyer',
          ...(shopName ? { name: shopName } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'Invalid OTP');

      if (isNewUser) {
        // New buyer — collect profile first
        transitionToProfile();
      } else {
        // Existing buyer — sign in directly
        await signIn(
          data.access_token,
          String(data.user_id),
          data.name ?? '',
          phoneNumber,
          data.shop_type ?? '',
        );
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'OTP verification failed. Try again.');
    } finally {
      setOtpBusy(false);
    }
  }, [otp, phoneNumber, isNewUser, shopName, signIn, transitionToProfile]);

  // ── Complete profile & sign in ────────────────────────────────────────────────
  const handleCompleteProfile = useCallback(async () => {
    if (!shopName.trim()) {
      Alert.alert('Required', 'Please enter your shop / business name.');
      return;
    }
    if (!shopType) {
      Alert.alert('Required', 'Please select your business type.');
      return;
    }

    setProfileBusy(true);
    try {
      // Re-verify OTP with name so backend creates the buyer record properly
      const res = await fetch(`${API_BASE}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '+91' + phoneNumber,
          otp: otp.join(''),
          role: 'buyer',
          name: shopName.trim(),
          shop_type: shopType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'Registration failed');

      await signIn(
        data.access_token,
        String(data.user_id),
        shopName.trim(),
        phoneNumber,
        shopType,
      );
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not complete registration. Try again.');
    } finally {
      setProfileBusy(false);
    }
  }, [shopName, shopType, phoneNumber, otp, signIn]);

  // ── OTP input handlers ────────────────────────────────────────────────────────
  const handleOtpChange = useCallback((text: string, index: number) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  }, [otp]);

  const handleOtpKeyPress = useCallback((key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const handleResend = useCallback(() => {
    if (!canResend) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    handleSendOtp();
  }, [canResend, handleSendOtp]);

  // ── Render phone stage ────────────────────────────────────────────────────────
  const renderPhoneStage = () => (
    <>
      <Text style={styles.cardTitle}>Source Fresh Produce</Text>
      <Text style={styles.cardSubtitle}>Connect with farmers near you</Text>

      <View style={styles.phoneRow}>
        <View style={styles.countryCode}>
          <Text style={styles.countryCodeText}>🇮🇳 +91</Text>
        </View>
        <TextInput
          style={styles.phoneInput}
          value={phoneNumber}
          onChangeText={t => setPhoneNumber(t.replace(/\D/g, '').slice(0, 10))}
          placeholder="Mobile number"
          placeholderTextColor="#9CA3AF"
          keyboardType="phone-pad"
          maxLength={10}
          returnKeyType="done"
          onSubmitEditing={handleSendOtp}
        />
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, phoneBusy && styles.primaryBtnDisabled]}
        onPress={handleSendOtp}
        disabled={phoneBusy}
        activeOpacity={0.85}
      >
        {phoneBusy
          ? <ActivityIndicator color="#FFFFFF" />
          : <Text style={styles.primaryBtnText}>Send OTP →</Text>
        }
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        By continuing, you agree to our{' '}
        <Text style={styles.disclaimerLink}>Terms of Service</Text>
        {' '}and{' '}
        <Text style={styles.disclaimerLink}>Privacy Policy</Text>
      </Text>
    </>
  );

  // ── Render OTP stage ──────────────────────────────────────────────────────────
  const renderOtpStage = () => (
    <>
      <TouchableOpacity onPress={() => setStage('phone')} style={styles.backBtn}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.cardTitle}>Enter OTP</Text>
      <Text style={styles.cardSubtitle}>
        Sent to +91 {phoneNumber}
      </Text>

      <View style={styles.otpRow}>
        {otp.map((digit, i) => (
          <TextInput
            key={i}
            ref={ref => { otpRefs.current[i] = ref; }}
            style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
            value={digit}
            onChangeText={t => handleOtpChange(t, i)}
            onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, i)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
            textAlign="center"
          />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, otpBusy && styles.primaryBtnDisabled]}
        onPress={handleVerifyOtp}
        disabled={otpBusy}
        activeOpacity={0.85}
      >
        {otpBusy
          ? <ActivityIndicator color="#FFFFFF" />
          : <Text style={styles.primaryBtnText}>Verify OTP</Text>
        }
      </TouchableOpacity>

      <View style={styles.resendRow}>
        {canResend ? (
          <TouchableOpacity onPress={handleResend}>
            <Text style={styles.resendActive}>Resend OTP</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.resendTimer}>
            Resend in <Text style={styles.resendTimerBold}>{countdown}s</Text>
          </Text>
        )}
      </View>
    </>
  );

  // ── Render profile stage ──────────────────────────────────────────────────────
  const renderProfileStage = () => (
    <>
      <Text style={styles.cardTitle}>Tell us about your business</Text>
      <Text style={styles.cardSubtitle}>Help farmers know who they're selling to</Text>

      <Text style={styles.fieldLabel}>Shop / Business name</Text>
      <TextInput
        style={styles.textInput}
        value={shopName}
        onChangeText={setShopName}
        placeholder="e.g. Shivaji Kirana Stores"
        placeholderTextColor="#9CA3AF"
        returnKeyType="done"
        autoCapitalize="words"
      />

      <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Business type</Text>
      <View style={styles.chipsGrid}>
        {BUSINESS_TYPES.map(bt => {
          const selected = shopType === bt.value;
          return (
            <TouchableOpacity
              key={bt.value}
              style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
              onPress={() => setShopType(bt.value)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextUnselected]}>
                {bt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, { marginTop: 24 }, profileBusy && styles.primaryBtnDisabled]}
        onPress={handleCompleteProfile}
        disabled={profileBusy}
        activeOpacity={0.85}
      >
        {profileBusy
          ? <ActivityIndicator color="#FFFFFF" />
          : <Text style={styles.primaryBtnText}>Start Buying →</Text>
        }
      </TouchableOpacity>
    </>
  );

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Hero background */}
      <View style={styles.hero}>
        {/* Decorative circles */}
        <View style={[styles.circle, styles.circleTop]} />
        <View style={[styles.circle, styles.circleMid]} />

        {/* Logo block */}
        <Animated.View style={[styles.logoBlock, animLogo]}>
          <Text style={styles.logoEmoji}>🏪</Text>
          <Text style={styles.logoAppName}>KisanShakti</Text>
          <Text style={styles.logoSubtitle}>MANDI · ಮಂಡಿ</Text>
          <View style={styles.logoDivider} />
          <Text style={styles.logoTagline}>Fresh from the farm, direct to you</Text>
        </Animated.View>
      </View>

      {/* Slide-up card */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.card, animCard]}>
          {stage === 'phone'   && renderPhoneStage()}
          {stage === 'otp'     && renderOtpStage()}
          {stage === 'profile' && renderProfileStage()}
        </Animated.View>

        <Text style={styles.footerBadge}>🌾 Empowering farmers, enabling trade</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },

  // Hero section
  hero: {
    height: SCREEN_HEIGHT * 0.42,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  circle: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.15)',
  },
  circleTop: {
    width: 300,
    height: 300,
    top: -100,
    right: -80,
    backgroundColor: 'rgba(217,119,6,0.05)',
  },
  circleMid: {
    width: 200,
    height: 200,
    bottom: -60,
    left: -60,
    backgroundColor: 'rgba(45,106,79,0.08)',
  },

  // Logo
  logoBlock: {
    alignItems: 'center',
  },
  logoEmoji: {
    fontSize: 52,
    marginBottom: 8,
  },
  logoAppName: {
    fontSize: 30,
    fontFamily: 'Inter_800ExtraBold',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  logoSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#D97706',
    letterSpacing: 3,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  logoDivider: {
    width: 40,
    height: 2,
    backgroundColor: '#D97706',
    borderRadius: 2,
    marginVertical: 12,
  },
  logoTagline: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.3,
  },

  // Scroll / card area
  scrollContent: {
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 40,
    minHeight: SCREEN_HEIGHT * 0.62,
  },

  // Card typography
  cardTitle: {
    fontSize: 22,
    fontFamily: 'Inter_800ExtraBold',
    color: '#111827',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginBottom: 28,
    lineHeight: 20,
  },

  // Back button
  backBtn: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#D97706',
  },

  // Phone input
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    marginBottom: 20,
    overflow: 'hidden',
  },
  countryCode: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    backgroundColor: '#F3F4F6',
  },
  countryCodeText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#374151',
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
  },

  // Primary button
  primaryBtn: {
    backgroundColor: '#D97706',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryBtnDisabled: {
    opacity: 0.65,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // Disclaimer
  disclaimer: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 16,
  },
  disclaimerLink: {
    color: '#D97706',
    fontFamily: 'Inter_700Bold',
  },

  // OTP boxes
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 54,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#111827',
    backgroundColor: '#F9FAFB',
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: '#D97706',
    backgroundColor: '#FEF3C7',
  },

  // Resend
  resendRow: {
    alignItems: 'center',
    marginTop: 16,
  },
  resendTimer: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
  },
  resendTimerBold: {
    fontFamily: 'Inter_700Bold',
    color: '#6B7280',
  },
  resendActive: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#D97706',
  },

  // Profile fields
  fieldLabel: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#374151',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#111827',
  },

  // Business type chips
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 50,
  },
  chipSelected: {
    backgroundColor: '#1B4332',
  },
  chipUnselected: {
    backgroundColor: '#F3F4F6',
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  chipTextUnselected: {
    color: '#374151',
  },

  // Footer
  footerBadge: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingVertical: 20,
    backgroundColor: '#1A1A2E',
  },
});
