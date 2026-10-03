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
  Image,
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
// Reads from EXPO_PUBLIC_API_URL at bundle time — set it in eas.json's env
// per profile, or before `expo start` for dev. Falls back to the Android
// emulator loopback (10.0.2.2) so an emulator user still gets a valid URL.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';
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
  // Set from verify-otp response — NOT from send-otp (which doesn't return it).
  // Also true when the backend detects a legacy buyer whose shop_name is a
  // phone number (from an older signup flow that used a fallback).
  const [needsProfile, setNeedsProfile] = useState(false);
  // Persisted from verify-otp so the profile-completion step can PATCH
  // /buyers/me with the buyer's JWT instead of trying to re-verify a
  // consumed OTP (which used to 401).
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [buyerId, setBuyerId] = useState<string | null>(null);

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
      // Note: `is_new_user` is NOT in the send-otp response — it's decided by
      // verify-otp when we know the OTP was correct. Do not read it here.
      transitionToOtp();
      if (data.dev_otp) {
        Alert.alert('🔑 Dev OTP', `Code: ${data.dev_otp}`, [
          { text: 'Auto-fill', onPress: () => setOtp(String(data.dev_otp).split('')) },
        ]);
      }
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'Invalid OTP');

      // Stash the token + id so the profile step can PATCH /buyers/me. The
      // OTP is consumed by this call — a second verify-otp would 401.
      setAuthToken(data.access_token);
      setBuyerId(String(data.user_id));
      const requiresProfile = Boolean(data.needs_profile ?? data.is_new_user);
      setNeedsProfile(requiresProfile);

      if (requiresProfile) {
        transitionToProfile();
      } else {
        await signIn(
          data.access_token,
          String(data.user_id),
          data.shop_name ?? '',
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
  }, [otp, phoneNumber, signIn, transitionToProfile]);

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

    if (!authToken) {
      Alert.alert('Session expired', 'Please request a new OTP.');
      setStage('phone');
      return;
    }

    setProfileBusy(true);
    try {
      // PATCH the buyer record with the JWT we already have from verify-otp.
      // Re-verifying OTP here would fail because the OTP was consumed.
      const res = await fetch(`${API_BASE}/api/v1/buyers/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          shop_name: shopName.trim(),
          shop_type: shopType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'Could not save profile');

      await signIn(
        authToken,
        buyerId ?? String(data.id ?? ''),
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
  }, [shopName, shopType, phoneNumber, authToken, buyerId, signIn]);

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

      {/* Consent sits inline right below the CTA — scrolls with the card,
          never overlaps content. Muted styling keeps it out of the way.
          The two spans are tappable and jump into the full legal screens. */}
      <Text style={styles.disclaimer}>
        By continuing, you agree to our{' '}
        <Text style={styles.disclaimerLink} onPress={() => router.push('/legal/terms')}>
          Terms of Service
        </Text>
        {' '}and{' '}
        <Text style={styles.disclaimerLink} onPress={() => router.push('/legal/privacy')}>
          Privacy Policy
        </Text>
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
      {/* Hero background — clean solid charcoal, no decorative circles.
           The custom logo is the visual focus. */}
      <View style={styles.hero}>
        {/* Logo block — uses the custom Mandi_icon.png the founder designed.
             `resizeMode="contain"` keeps the artwork's aspect ratio no matter
             the screen size. */}
        <Animated.View style={[styles.logoBlock, animLogo]}>
          {/* Handshake artwork spans the full hero width — the two hands read
              as coming from opposite edges of the screen, which is exactly
              the buyer-meets-farmer moment Mandi represents. No circle/halo
              behind it (the "balloon" that boxed in the artwork). */}
          <Image
            source={require('../../assets/images/mandi-logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.logoSubtitle}>MANDI · ಮಂಡಿ</Text>
          <View style={styles.logoDivider} />
          <Text style={styles.logoTagline}>Fresh from the farm, direct to you</Text>
        </Animated.View>
      </View>

      {/* Card takes flex: 1 so it fills the remaining screen exactly. Phone
          + OTP stages fit natively — no scroll bounce. Profile stage has
          more content (name + 4 business chips) so it's wrapped in its own
          ScrollView to handle overflow on smaller phones. */}
      <Animated.View style={[styles.card, animCard]}>
        {stage === 'phone' && renderPhoneStage()}
        {stage === 'otp'   && renderOtpStage()}
        {stage === 'profile' && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {renderProfileStage()}
          </ScrollView>
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
// Mandi palette — intentionally DIFFERENT from Upaj (Upaj is all-green, the
// farmer voice). Mandi is buyer/commerce: warm charcoal + amber gold, the
// Zomato/Swiggy/Blinkit family. Reads as "marketplace, appetite, energy"
// without a shred of green — so the two apps feel like sibling brands
// with different personalities, not two green clones.
const C = {
  heroDeep:      '#1F1B24',   // warm charcoal (slight aubergine warmth, NOT navy blue)
  heroMid:       '#2A2530',
  cardCream:     '#FFFDF7',   // ivory card
  primary:       '#F59E0B',   // amber gold — CTAs, commerce accent
  primaryDark:   '#B45309',
  amber:         '#F59E0B',   // same as primary; kept alias for readability
  ink:           '#111318',
  body:          '#374151',
  muted:         '#6B7280',
  hairline:      '#F0EDE5',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.heroDeep,
  },

  // Hero — solid warm charcoal, clean. 42% of screen so the handshake
  // logo, subtitle, and tagline all breathe. Card below takes the rest
  // (58%) via flex: 1 with NO negative margin so nothing is covered.
  hero: {
    height: SCREEN_HEIGHT * 0.42,
    backgroundColor: C.heroDeep,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    paddingHorizontal: 0,
    paddingBottom: 20,
  },
  // Logo — the handshake artwork stretches across the full hero width so
  // the two hands look like they're coming in from the left/right screen
  // edges (the visual metaphor for buyer + farmer meeting in the middle).
  logoBlock: {
    alignItems: 'center',
    width: '100%',
    zIndex: 2,
  },
  logoImage: {
    // Full-width handshake, height sized so the subtitle + tagline below
    // still have breathing room inside the 42%-tall hero.
    width: '100%',
    height: 170,
    marginBottom: 4,
  },
  logoSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_800ExtraBold',
    color: C.amber,
    letterSpacing: 4,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  logoDivider: {
    width: 32,
    height: 2,
    backgroundColor: 'rgba(217,119,6,0.5)',
    borderRadius: 2,
    marginVertical: 10,
  },
  logoTagline: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.3,
  },

  // Card fills the remaining space (~58% of screen) via flex: 1. No
  // negative margin — the hero's rounded corners and the card's rounded
  // top sit flush against each other. Content fits without scroll.
  card: {
    flex: 1,
    backgroundColor: C.cardCream,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 26,
    paddingTop: 26,
    paddingBottom: 20,
    // Subtle shadow lifts the card off the hero
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },

  // Card typography — bigger, more display-worthy title with a warm eyebrow
  eyebrow: {
    fontSize: 11,
    fontFamily: 'Inter_800ExtraBold',
    color: C.amber,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 26,
    fontFamily: 'Inter_800ExtraBold',
    color: C.ink,
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.muted,
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
    color: C.primary,
  },

  // Phone input — cleaner, more premium; subtle amber flag chip anchors it
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.hairline,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 22,
    overflow: 'hidden',
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: C.hairline,
    backgroundColor: '#FEFCF6',
  },
  countryCodeText: {
    fontSize: 15,
    fontFamily: 'Inter_800ExtraBold',
    color: C.ink,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: C.ink,
    letterSpacing: 0.5,
  },

  // Primary button
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primaryDark,
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

  // Disclaimer — inline below the primary CTA. Muted so it doesn't compete.
  disclaimer: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.muted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 16,
  },
  disclaimerLink: {
    color: C.amber,
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
    borderColor: C.primary,
    backgroundColor: '#ECFDF5',
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
    color: C.amber,
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

});
