import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../hooks/use-auth';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.183.6.220:8000';

type Step = 'phone' | 'otp';

const OTP_LENGTH = 6;
const RESEND_COUNTDOWN = 30;

export default function LoginScreen() {
  const auth = useAuth();

  // ── Step state ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('phone');

  // ── Phone stage ────────────────────────────────────────────────────────────
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [phoneSending, setPhoneSending] = useState(false);

  // ── OTP stage ──────────────────────────────────────────────────────────────
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [otpError, setOtpError] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COUNTDOWN);
  const [isNewUser, setIsNewUser] = useState(false);
  const [farmerName, setFarmerName] = useState('');

  const otpRefs = useRef<Array<TextInput | null>>(Array(OTP_LENGTH).fill(null));
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Animation ──────────────────────────────────────────────────────────────
  const cardTranslateY = useRef(new Animated.Value(60)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(cardTranslateY, {
      toValue: 0,
      damping: 18,
      stiffness: 160,
      useNativeDriver: true,
    }).start();
    Animated.timing(cardOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  // ── Countdown timer ────────────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    setCountdown(RESEND_COUNTDOWN);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const fullPhone = `+91${phoneNumber}`;

  const formatCountdown = () => {
    const m = Math.floor(countdown / 60);
    const s = countdown % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── API: send OTP ──────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    setPhoneError('');
    if (phoneNumber.length !== 10) {
      setPhoneError('Please enter a valid 10-digit mobile number.');
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
      if (!res.ok) {
        setPhoneError(data?.detail ?? 'Failed to send OTP. Try again.');
        return;
      }
      startCountdown();
      setOtp(Array(OTP_LENGTH).fill(''));
      setOtpError('');
      setStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 350);
    } catch {
      setPhoneError('Network error. Please check your connection.');
    } finally {
      setPhoneSending(false);
    }
  };

  // ── API: verify OTP ────────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    setOtpError('');
    if (otp.join('').length < OTP_LENGTH) {
      setOtpError('Please enter the complete 6-digit OTP.');
      return;
    }
    if (isNewUser && farmerName.trim().length < 2) {
      setOtpError('Please enter your full name.');
      return;
    }
    Keyboard.dismiss();
    setOtpVerifying(true);
    try {
      const body: Record<string, string> = {
        phone: fullPhone,
        otp: otp.join(''),
        role: 'farmer',
      };
      if (farmerName.trim()) body.name = farmerName.trim();

      const res = await fetch(`${API_BASE}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data?.detail ?? 'Invalid OTP. Please try again.');
        return;
      }

      if (data.is_new_user && !isNewUser) {
        setIsNewUser(true);
        setOtpError('');
        setOtpVerifying(false);
        return;
      }

      await auth.signIn(
        data.access_token,
        String(data.user_id),
        data.name ?? farmerName.trim(),
        fullPhone,
      );
      router.replace('/(tabs)');
    } catch {
      setOtpError('Network error. Please check your connection.');
    } finally {
      setOtpVerifying(false);
    }
  };

  // ── OTP box handlers ───────────────────────────────────────────────────────
  const handleOtpChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      const next = [...otp];
      next[index - 1] = '';
      setOtp(next);
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, role: 'farmer' }),
      });
      if (!res.ok) {
        const data = await res.json();
        setOtpError(data?.detail ?? 'Failed to resend OTP.');
        return;
      }
      startCountdown();
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch {
      setOtpError('Network error. Please check your connection.');
    } finally {
      setPhoneSending(false);
    }
  };

  const goBackToPhone = () => {
    setStep('phone');
    setOtp(Array(OTP_LENGTH).fill(''));
    setOtpError('');
    setIsNewUser(false);
    setFarmerName('');
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0D2818" />

        {/* ── Hero Section ────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          {/* Decorative rings */}
          <View style={[styles.ring, styles.ring1]} />
          <View style={[styles.ring, styles.ring2]} />
          <View style={[styles.ring, styles.ring3]} />
          <View style={[styles.ring, styles.ring4]} />

          <SafeAreaView style={styles.heroContent}>
            <View style={styles.logoRow}>
              <Text style={styles.logoEmoji}>🌿</Text>
              <Text style={styles.logoText}>KisanShakti</Text>
            </View>
            <Text style={styles.logoSubtitle}>UPAJ · ಉಪಜ್</Text>
          </SafeAreaView>
        </View>

        {/* ── Card Section ─────────────────────────────────────────────────── */}
        <KeyboardAvoidingView
          style={styles.cardWrapper}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Animated.View
            style={[
              styles.card,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardTranslateY }],
              },
            ]}
          >
            {step === 'phone' ? (
              <PhoneStage
                phoneNumber={phoneNumber}
                setPhoneNumber={setPhoneNumber}
                phoneError={phoneError}
                sending={phoneSending}
                onSend={handleSendOtp}
              />
            ) : (
              <OtpStage
                phone={phoneNumber}
                otp={otp}
                focusedIndex={focusedIndex}
                setFocusedIndex={setFocusedIndex}
                otpRefs={otpRefs}
                otpError={otpError}
                verifying={otpVerifying}
                countdown={countdown}
                isNewUser={isNewUser}
                farmerName={farmerName}
                setFarmerName={setFarmerName}
                formatCountdown={formatCountdown}
                onOtpChange={handleOtpChange}
                onOtpKeyPress={handleOtpKeyPress}
                onVerify={handleVerifyOtp}
                onResend={handleResend}
                onBack={goBackToPhone}
              />
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

// ── Phone Stage Component ──────────────────────────────────────────────────────

interface PhoneStageProps {
  phoneNumber: string;
  setPhoneNumber: (v: string) => void;
  phoneError: string;
  sending: boolean;
  onSend: () => void;
}

function PhoneStage({
  phoneNumber,
  setPhoneNumber,
  phoneError,
  sending,
  onSend,
}: PhoneStageProps) {
  return (
    <View style={styles.stageContainer}>
      <Text style={styles.stageTitle}>Welcome Back!</Text>
      <Text style={styles.stageSubtitle}>Enter your mobile number to continue</Text>

      <View style={styles.phoneRow}>
        <View style={styles.flagBox}>
          <Text style={styles.flagText}>🇮🇳</Text>
          <Text style={styles.dialCode}>+91</Text>
        </View>
        <TextInput
          style={[styles.phoneInput, phoneError ? styles.inputError : null]}
          placeholder="Mobile number"
          placeholderTextColor="#9CA3AF"
          keyboardType="number-pad"
          maxLength={10}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          returnKeyType="done"
          onSubmitEditing={onSend}
        />
      </View>

      {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryButton, sending && styles.primaryButtonDisabled]}
        onPress={onSend}
        activeOpacity={0.85}
        disabled={sending}
      >
        {sending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Get OTP</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.termsText}>
        By continuing, you agree to our{' '}
        <Text style={styles.termsLink}>Terms</Text> &amp;{' '}
        <Text style={styles.termsLink}>Privacy Policy</Text>
      </Text>
    </View>
  );
}

// ── OTP Stage Component ────────────────────────────────────────────────────────

interface OtpStageProps {
  phone: string;
  otp: string[];
  focusedIndex: number | null;
  setFocusedIndex: (i: number | null) => void;
  otpRefs: React.MutableRefObject<Array<TextInput | null>>;
  otpError: string;
  verifying: boolean;
  countdown: number;
  isNewUser: boolean;
  farmerName: string;
  setFarmerName: (v: string) => void;
  formatCountdown: () => string;
  onOtpChange: (text: string, index: number) => void;
  onOtpKeyPress: (key: string, index: number) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
}

function OtpStage({
  phone,
  otp,
  focusedIndex,
  setFocusedIndex,
  otpRefs,
  otpError,
  verifying,
  countdown,
  isNewUser,
  farmerName,
  setFarmerName,
  formatCountdown,
  onOtpChange,
  onOtpKeyPress,
  onVerify,
  onResend,
  onBack,
}: OtpStageProps) {
  return (
    <View style={styles.stageContainer}>
      {/* Back button */}
      <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backLabel}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.stageTitle}>Verify OTP</Text>
      <Text style={styles.stageSubtitle}>Sent to +91 {phone}</Text>

      {/* OTP boxes */}
      <View style={styles.otpRow}>
        {otp.map((digit, index) => (
          <TextInput
            key={index}
            ref={ref => {
              otpRefs.current[index] = ref;
            }}
            style={[
              styles.otpBox,
              focusedIndex === index && styles.otpBoxFocused,
              digit ? styles.otpBoxFilled : null,
            ]}
            value={digit}
            onChangeText={text => onOtpChange(text, index)}
            onKeyPress={({ nativeEvent }) => onOtpKeyPress(nativeEvent.key, index)}
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

      {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}

      {/* Resend */}
      <View style={styles.resendRow}>
        {countdown > 0 ? (
          <Text style={styles.resendTimer}>Resend in {formatCountdown()}</Text>
        ) : (
          <TouchableOpacity onPress={onResend} activeOpacity={0.7}>
            <Text style={styles.resendLink}>Resend OTP</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Name input for new users */}
      {isNewUser && (
        <View style={styles.nameInputWrapper}>
          <Text style={styles.nameLabel}>Your name (for your farm profile)</Text>
          <TextInput
            style={styles.nameInput}
            placeholder="Full name"
            placeholderTextColor="#9CA3AF"
            value={farmerName}
            onChangeText={setFarmerName}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, verifying && styles.primaryButtonDisabled]}
        onPress={onVerify}
        activeOpacity={0.85}
        disabled={verifying}
      >
        {verifying ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Verify &amp; Continue</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0D2818',
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    height: HERO_HEIGHT,
    backgroundColor: '#0D2818',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },

  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  ring1: {
    width: 320,
    height: 320,
    top: -140,
    right: -100,
    opacity: 0.08,
  },
  ring2: {
    width: 220,
    height: 220,
    top: -60,
    right: -40,
    opacity: 0.12,
  },
  ring3: {
    width: 180,
    height: 180,
    bottom: 20,
    left: -70,
    opacity: 0.07,
  },
  ring4: {
    width: 100,
    height: 100,
    bottom: 40,
    left: -20,
    opacity: 0.13,
  },

  heroContent: {
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoEmoji: {
    fontSize: 32,
  },
  logoText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 28,
    color: '#FFFFFF',
  },
  logoSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: 'rgba(255,255,255,0.70)',
    letterSpacing: 3,
    marginTop: 6,
  },

  // ── Card ──────────────────────────────────────────────────────────────────
  cardWrapper: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },

  // ── Stage shared ──────────────────────────────────────────────────────────
  stageContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
  },
  stageTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 26,
    color: '#111827',
    marginBottom: 6,
  },
  stageSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: '#6B7A99',
    marginBottom: 28,
  },

  // ── Phone input ───────────────────────────────────────────────────────────
  phoneRow: {
    flexDirection: 'row',
    marginBottom: 8,
    borderRadius: 14,
    overflow: 'hidden',
  },
  flagBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRightWidth: 0,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  flagText: {
    fontSize: 20,
  },
  dialCode: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#1B4332',
  },
  phoneInput: {
    flex: 1,
    height: 56,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 0,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#DC2626',
  },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#DC2626',
    marginTop: 4,
    marginBottom: 8,
  },

  // ── Primary button ────────────────────────────────────────────────────────
  primaryButton: {
    width: '100%',
    height: 56,
    backgroundColor: '#1B4332',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // ── Terms ─────────────────────────────────────────────────────────────────
  termsText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
  termsLink: {
    color: '#2D6A4F',
    fontFamily: 'Inter_700Bold',
  },

  // ── Back button ───────────────────────────────────────────────────────────
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  backArrow: {
    fontSize: 20,
    color: '#1B4332',
    lineHeight: 22,
  },
  backLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: '#1B4332',
  },

  // ── OTP boxes ─────────────────────────────────────────────────────────────
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  otpBox: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: '#111827',
  },
  otpBoxFocused: {
    borderColor: '#1B4332',
    backgroundColor: '#F0FDF4',
  },
  otpBoxFilled: {
    borderColor: '#2D6A4F',
  },

  // ── Resend ────────────────────────────────────────────────────────────────
  resendRow: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  resendTimer: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#9CA3AF',
  },
  resendLink: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#1B4332',
  },

  // ── Name input ────────────────────────────────────────────────────────────
  nameInputWrapper: {
    marginTop: 20,
  },
  nameLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#6B7A99',
    marginBottom: 8,
  },
  nameInput: {
    height: 52,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
});
