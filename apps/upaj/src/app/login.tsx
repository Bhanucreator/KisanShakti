/**
 * Login + Onboarding Wizard
 * ──────────────────────────
 * Matches the reference design at pages/home.jpeg:
 *   - Top hero: bilingual logo + language toggle + tagline + feature pills
 *   - Bottom rounded white card that hosts the multi-step wizard:
 *       1. Phone → OTP
 *       2. Name
 *       3. Location (auto GPS or manual entry)
 *       4. Total land in hectares
 *       5. Add crops (crop + hectares per crop)
 *       6. Done — writes to local SQLite and pushes to backend
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Easing,
  Keyboard, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
  Dimensions, StatusBar, Alert, Image,
} from 'react-native';
import { router } from 'expo-router';
import { SafeGradient as LinearGradient } from '../components/safe-gradient';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useAuth } from '../hooks/use-auth';
import { replaceFarmerCrops, getFarmerProfile } from '../lib/local-db';

// Lazy-load expo-location — may not be in older APKs
let Location: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Location = require('expo-location');
} catch { Location = null; }

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://kisanshakti-backend.onrender.com';

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  primary: '#2D6A4F',
  primaryDark: '#1B4332',
  primaryBright: '#40916C',
  primaryNeon: '#52B788',
  primaryPale: '#D8F3DC',
  primaryTint: '#F0FDF4',
  bg: '#F8F9F5',
  card: '#FFFFFF',
  border: '#E5E7EB',
  textDark: '#0F1F17',
  textBody: '#2C3E37',
  textMuted: '#6B7A73',
  textLight: '#9CA8A1',
  red: '#DC2626',
};

// Onboarding flow is intentionally short: phone → OTP → name → location →
// land → done. Crops are NOT collected here; the farmer's crop types are
// derived from what they actually log in the Business (Ledger) tab. This
// keeps signup fast and prevents the double-entry pain of asking about
// crops both here and in the Business feature.
type Step = 'phone' | 'otp' | 'name' | 'location' | 'land';
const OTP_LENGTH = 6;
const RESEND_COUNTDOWN = 30;

// ── Main Component ──────────────────────────────────────────────────────────
export default function LoginScreen() {
  const auth = useAuth();
  const [lang, setLang] = useState<'en' | 'kn'>('en');
  const [step, setStep] = useState<Step>('phone');

  // ── Phone / OTP state ─────
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [phoneSending, setPhoneSending] = useState(false);

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_COUNTDOWN);
  const otpRefs = useRef<Array<TextInput | null>>(Array(OTP_LENGTH).fill(null));
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Onboarding state ─────
  const [farmerName, setFarmerName] = useState('');
  const [locName, setLocName] = useState('');
  const [locLat, setLocLat] = useState<number | null>(null);
  const [locLng, setLocLng] = useState<number | null>(null);
  const [locFetching, setLocFetching] = useState(false);
  const [landHa, setLandHa] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Animations ─────
  const cardTranslateY = useRef(new Animated.Value(60)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const stepSlide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(cardTranslateY, { toValue: 0, damping: 22, stiffness: 160, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  // Animate step change
  const goToStep = useCallback((next: Step, direction: 'forward' | 'back' = 'forward') => {
    Animated.timing(stepSlide, {
      toValue: direction === 'forward' ? -30 : 30,
      duration: 150, useNativeDriver: true,
    }).start(() => {
      setStep(next);
      stepSlide.setValue(direction === 'forward' ? 30 : -30);
      Animated.spring(stepSlide, { toValue: 0, damping: 22, stiffness: 200, useNativeDriver: true }).start();
    });
  }, []);

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

  // ── Send OTP ─────────────────────────────
  const handleSendOtp = async () => {
    setPhoneError('');
    if (phoneNumber.length !== 10) {
      setPhoneError(t('Enter a valid 10-digit mobile number', 'ಸರಿಯಾದ 10-ಅಂಕಿಯ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ'));
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
      goToStep('otp');
      if (data.dev_otp) {
        Alert.alert('🔑 Dev OTP', `Code: ${data.dev_otp}`, [
          { text: 'Auto-fill', onPress: () => setOtp(data.dev_otp.split('')) }
        ]);
      }
    } catch {
      setPhoneError(`Cannot reach ${API_BASE}. Check backend & Wi-Fi.`);
    } finally { setPhoneSending(false); }
  };

  // ── Verify OTP → sign in → continue onboarding ─────
  const handleVerifyOtp = async () => {
    setOtpError('');
    if (otp.join('').length < OTP_LENGTH) {
      setOtpError(t('Enter the complete 6-digit OTP', 'ಸಂಪೂರ್ಣ 6-ಅಂಕಿಯ OTP ನಮೂದಿಸಿ'));
      return;
    }
    Keyboard.dismiss();
    setOtpVerifying(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: fullPhone, otp: otp.join(''), role: 'farmer',
          name: farmerName || phoneNumber,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setOtpError(data?.detail ?? 'Invalid OTP'); return; }

      // Save token to local SQLite (preserves existing profile on same phone)
      await auth.signIn({
        token:     data.access_token,
        server_id: String(data.user_id),
        phone:     fullPhone,
        name:      farmerName || '',
      });

      // Check local SQLite for an already-completed profile on this device
      const local = await getFarmerProfile();
      const hasLocalProfile =
        local?.name?.trim() &&
        local?.location_name?.trim() &&
        (local?.total_land_ha ?? 0) > 0;

      if (hasLocalProfile) {
        await auth.updateProfile({ onboarded: true });
        router.replace('/(tabs)');
        return;
      }

      // No local profile → try to fetch from backend before asking again
      if (!data.is_new_user) {
        try {
          const meRes = await fetch(`${API_BASE}/api/v1/farmers/me`, {
            headers: { Authorization: `Bearer ${data.access_token}` },
          });
          if (meRes.ok) {
            const me = await meRes.json();
            if (me.full_name && me.location_name && (me.total_land_ha ?? 0) > 0) {
              // Server has a complete profile — hydrate local DB and skip onboarding
              await auth.updateProfile({
                name:          me.full_name,
                location_name: me.location_name,
                latitude:      me.latitude ?? undefined,
                longitude:     me.longitude ?? undefined,
                total_land_ha: me.total_land_ha,
                onboarded:     true,
              });
              if (Array.isArray(me.crops) && me.crops.length > 0) {
                const profile = await getFarmerProfile();
                if (profile) {
                  await replaceFarmerCrops(profile.id, me.crops.map((c: any) => ({
                    crop_name: c.crop_name,
                    crop_name_kn: c.crop_name_kn,
                    land_ha: c.land_ha,
                  })));
                }
              }
              router.replace('/(tabs)');
              return;
            }
          }
        } catch (e) {
          console.warn('[login] server hydrate failed:', e);
        }
      }

      // No profile anywhere → run onboarding wizard
      goToStep('name');
    } catch {
      setOtpError('Network error. Please try again.');
    } finally { setOtpVerifying(false); }
  };

  // ── OTP box handlers ─────
  const handleOtpChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otp]; next[index] = digit; setOtp(next);
    if (digit && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
  };
  const handleOtpKey = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      const next = [...otp]; next[index - 1] = ''; setOtp(next);
      otpRefs.current[index - 1]?.focus();
    }
  };

  // ── Name step ─────
  const handleNameNext = () => {
    if (farmerName.trim().length < 2) return Alert.alert('Name required', 'Please enter your full name');
    goToStep('location');
  };

  // ── Location step: auto GPS ─────
  const handleAutoLocation = async () => {
    if (!Location) {
      Alert.alert('Location Unavailable', 'GPS module needs a newer APK. Please enter manually.');
      return;
    }
    setLocFetching(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant location access or enter manually.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocLat(pos.coords.latitude);
      setLocLng(pos.coords.longitude);

      // Reverse geocode
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        });
        const p = places[0];
        if (p) {
          const label = [p.name, p.district, p.region ?? p.subregion, p.country]
            .filter(Boolean).join(', ');
          setLocName(label);
        }
      } catch (e) {
        console.warn('[reverseGeocode] failed', e);
      }
    } catch (e: any) {
      Alert.alert('GPS Error', e?.message ?? 'Could not fetch location. Enter manually.');
    } finally { setLocFetching(false); }
  };

  const handleLocationNext = () => {
    if (!locName.trim()) return Alert.alert('Location required', 'Enter your village/town or use GPS');
    goToStep('land');
  };

  // ── Land step is now the LAST wizard step. Instead of transitioning to a
  //    crops step, it finishes onboarding directly. Crop types are derived
  //    later from Business (Ledger) cycles, not collected here.
  const totalLand = parseFloat(landHa) || 0;

  const handleFinishOnboarding = async () => {
    const n = parseFloat(landHa);
    if (!n || n <= 0) return Alert.alert('Land required', 'Enter your total farm size in hectares');
    if (n > 500) return Alert.alert('Too large', 'Enter a value under 500 ha');

    setSavingProfile(true);
    try {
      const currentProfile = await getFarmerProfile();
      if (!currentProfile) throw new Error('Profile missing');

      // Update local SQLite
      await auth.updateProfile({
        name:          farmerName,
        location_name: locName,
        latitude:      locLat ?? undefined,
        longitude:     locLng ?? undefined,
        total_land_ha: totalLand,
        onboarded:     true,
      });

      // Push to backend (best-effort; local is source of truth)
      try {
        await fetch(`${API_BASE}/api/v1/farmers/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentProfile.auth_token}`,
          },
          body: JSON.stringify({
            full_name: farmerName,
            location_name: locName,
            latitude: locLat, longitude: locLng,
            total_land_ha: totalLand,
            // NOTE: no `crops` field — crop types are derived from cycles
            // logged in the Business tab, not declared here at signup.
          }),
        });
      } catch (e) {
        console.warn('[onboarding] backend sync deferred:', e);
      }

      router.replace('/(tabs)');
    } catch (e) {
      console.error('[onboarding] finish failed:', e);
      Alert.alert('Error', 'Could not save profile. Try again.');
    } finally { setSavingProfile(false); }
  };

  const t = (en: string, kn: string) => lang === 'en' ? en : kn;

  // ── Progress dots ─────
  const stepIndex = { phone: 0, otp: 1, name: 2, location: 3, land: 4 }[step];
  const totalSteps = 5;

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#EAF3E4" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ═══ HERO SECTION ═══ */}
          <LinearGradient
            colors={['#EAF3E4', '#D8F3DC', '#B7E4C7']}
            style={s.hero}
          >
            {/* Top row: Logo + Language toggle */}
            <View style={s.heroTopRow}>
              <View style={s.logoRow}>
                <View style={s.logoIcon}>
                  <MaterialCommunityIcons name="leaf" size={22} color={C.primary} />
                </View>
                <View>
                  <Text style={s.logoName}>
                    Kisan<Text style={{ color: C.primary }}>Shakti</Text>
                  </Text>
                  <Text style={s.logoKn}>ಕಿಸಾನ್ ಶಕ್ತಿ</Text>
                </View>
              </View>
              <TouchableOpacity
                style={s.langBtn}
                activeOpacity={0.8}
                onPress={() => setLang(l => l === 'en' ? 'kn' : 'en')}
              >
                <Ionicons name="globe-outline" size={13} color={C.primaryDark} />
                <Text style={s.langText}>{lang === 'en' ? 'ಕನ್ನಡ' : 'English'}</Text>
                <Feather name="chevron-down" size={11} color={C.primaryDark} />
              </TouchableOpacity>
            </View>

            {/* Tagline */}
            <Text style={s.tagline}>
              <Text style={{ color: C.textDark }}>{t('Smart farming', 'ಸ್ಮಾರ್ಟ್ ಕೃಷಿ')}</Text>
              {'\n'}
              <Text style={{ color: C.primary }}>{t('for smart farmers', 'ಸ್ಮಾರ್ಟ್ ರೈತರಿಗಾಗಿ')}</Text>
            </Text>
            <Text style={s.tagSub}>
              {t('AI insights, live weather, disease detection\n& best market prices',
                 'AI ಒಳನೋಟಗಳು, ನೇರ ಹವಾಮಾನ, ರೋಗ ಪತ್ತೆ\n& ಅತ್ಯುತ್ತಮ ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು')}
            </Text>

            {/* Feature pills */}
            <View style={s.featureRow}>
              <View style={s.featurePill}>
                <View style={s.featurePillIcon}>
                  <MaterialCommunityIcons name="shield-check" size={12} color={C.primary} />
                </View>
                <Text style={s.featurePillText}>{t('AI Disease Detection', 'AI ರೋಗ ಪತ್ತೆ')}</Text>
              </View>
              <View style={s.featurePill}>
                <View style={s.featurePillIcon}>
                  <Feather name="trending-up" size={12} color={C.primary} />
                </View>
                <Text style={s.featurePillText}>{t('Live Market Prices', 'ನೇರ ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು')}</Text>
              </View>
            </View>
          </LinearGradient>

          {/* ═══ WIZARD CARD ═══ */}
          <Animated.View
            style={[s.card, { opacity: cardOpacity, transform: [{ translateY: cardTranslateY }] }]}
          >
            {/* Progress bar */}
            <View style={s.progress}>
              {Array.from({ length: totalSteps }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.progressBar,
                    { backgroundColor: i <= stepIndex ? C.primary : '#E8ECE9' },
                    { width: i === stepIndex ? 22 : 14 },
                  ]}
                />
              ))}
            </View>

            <Animated.View style={{ transform: [{ translateX: stepSlide }] }}>
              {step === 'phone' && (
                <PhoneStep
                  t={t} phoneNumber={phoneNumber} setPhoneNumber={setPhoneNumber}
                  phoneError={phoneError} sending={phoneSending} onSend={handleSendOtp}
                />
              )}
              {step === 'otp' && (
                <OtpStep
                  t={t} phone={phoneNumber} otp={otp} otpRefs={otpRefs}
                  otpError={otpError} verifying={otpVerifying} countdown={countdown}
                  onOtpChange={handleOtpChange} onOtpKey={handleOtpKey}
                  onVerify={handleVerifyOtp} onBack={() => goToStep('phone', 'back')}
                />
              )}
              {step === 'name' && (
                <NameStep t={t} name={farmerName} setName={setFarmerName} onNext={handleNameNext} />
              )}
              {step === 'location' && (
                <LocationStep
                  t={t} locName={locName} setLocName={setLocName}
                  fetching={locFetching} onAutoFetch={handleAutoLocation}
                  onBack={() => goToStep('name', 'back')} onNext={handleLocationNext}
                />
              )}
              {step === 'land' && (
                <LandStep
                  t={t} landHa={landHa} setLandHa={setLandHa}
                  saving={savingProfile}
                  onBack={() => goToStep('location', 'back')}
                  onNext={handleFinishOnboarding}
                />
              )}
            </Animated.View>
          </Animated.View>

          {/* Spacer pushes footer to bottom of screen */}
          <View style={{ flex: 1, minHeight: 24 }} />

          {/* ═══ FOOTER ═══ */}
          <View style={s.footer}>
            <View style={s.footerDivider} />
            <View style={s.safetyPill}>
              <MaterialCommunityIcons name="shield-check" size={11} color={C.primary} />
              <Text style={s.safetyText}>{t('Your data is safe and never shared', 'ನಿಮ್ಮ ಡೇಟಾ ಸುರಕ್ಷಿತವಾಗಿದೆ')}</Text>
            </View>
            <Text style={s.terms}>
              {t('By continuing, you agree to our', 'ಮುಂದುವರೆಯುವ ಮೂಲಕ ನೀವು ಒಪ್ಪುತ್ತೀರಿ')}
              {' '}
              <Text style={s.termsLink}>{t('Terms', 'ನಿಯಮಗಳು')}</Text>
              {' & '}
              <Text style={s.termsLink}>{t('Privacy Policy', 'ಗೌಪ್ಯತಾ ನೀತಿ')}</Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ═══ STEP: Phone ═══════════════════════════════════════════════════════════
function PhoneStep({ t, phoneNumber, setPhoneNumber, phoneError, sending, onSend }: any) {
  return (
    <View>
      <View style={s.stepHeaderRow}>
        <View style={s.stepIconBox}>
          <MaterialCommunityIcons name="cellphone-check" size={16} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>{t('Welcome to KisanShakti', 'ಸ್ವಾಗತ')}</Text>
          <Text style={s.stepSub}>{t("Let's grow better, together.", 'ಜೊತೆಗೆ ಬೆಳೆಯೋಣ')}</Text>
        </View>
      </View>

      <Text style={s.fieldLabel}>{t('Mobile Number', 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ')}</Text>
      <Text style={s.fieldHint}>{t("We'll send you a 6-digit OTP", 'ನಾವು 6-ಅಂಕಿಯ OTP ಕಳುಹಿಸುತ್ತೇವೆ')}</Text>

      <View style={[s.phoneRow, phoneError && s.inputWrapError]}>
        <View style={s.flagBox}>
          <Text style={{ fontSize: 15 }}>🇮🇳</Text>
          <Text style={s.dialCode}>+91</Text>
          <Feather name="chevron-down" size={10} color={C.textMuted} />
        </View>
        <View style={s.phoneInputWrap}>
          <Feather name="phone" size={13} color={C.textLight} />
          <TextInput
            style={s.phoneInput}
            placeholder="98765 43210" placeholderTextColor="#9CA8A1"
            keyboardType="number-pad" maxLength={10}
            value={phoneNumber} onChangeText={setPhoneNumber}
            returnKeyType="done" onSubmitEditing={onSend} autoFocus
          />
        </View>
      </View>
      {!!phoneError && <ErrorLine text={phoneError} />}

      <TouchableOpacity onPress={onSend} disabled={sending} activeOpacity={0.9} style={{ marginTop: 18 }}>
        <LinearGradient
          colors={sending ? ['#889690', '#6B7A73'] : [C.primaryBright, C.primaryDark]}
          style={s.primaryBtn}
        >
          {sending ? <ActivityIndicator color="#FFF" />
            : (<><Text style={s.primaryBtnText}>{t('Get OTP', 'OTP ಪಡೆಯಿರಿ')}</Text>
                 <Ionicons name="arrow-forward" size={15} color="#FFF" /></>)}
        </LinearGradient>
      </TouchableOpacity>

      {/* Play Store review notes require an explicit consent line beside
          any button that creates or resumes an account. Tapping either link
          opens the full policy screen. */}
      <Text style={{ marginTop: 14, fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 16 }}>
        By continuing you agree to our{' '}
        <Text style={{ color: C.primaryDark, fontWeight: '700', textDecorationLine: 'underline' }}
              onPress={() => router.push('/legal/terms')}>Terms</Text>
        {' '}and{' '}
        <Text style={{ color: C.primaryDark, fontWeight: '700', textDecorationLine: 'underline' }}
              onPress={() => router.push('/legal/privacy')}>Privacy Policy</Text>.
      </Text>
    </View>
  );
}

// ═══ STEP: OTP ═════════════════════════════════════════════════════════════
function OtpStep({ t, phone, otp, otpRefs, otpError, verifying, countdown,
                   onOtpChange, onOtpKey, onVerify, onBack }: any) {
  return (
    <View>
      <View style={s.stepHeaderRow}>
        <TouchableOpacity style={s.backBtnSmall} onPress={onBack}>
          <Feather name="chevron-left" size={14} color={C.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>{t('Verify OTP', 'OTP ಪರಿಶೀಲಿಸಿ')}</Text>
          <Text style={s.stepSub}>{t('Sent to', 'ಇಗೆ ಕಳುಹಿಸಲಾಗಿದೆ')} <Text style={{ fontFamily: 'Inter_700Bold', color: C.textDark }}>+91 {phone}</Text></Text>
        </View>
      </View>

      <View style={s.otpRow}>
        {otp.map((digit: string, i: number) => (
          <TextInput
            key={i}
            ref={(r: any) => { otpRefs.current[i] = r; }}
            style={[s.otpBox, digit && s.otpBoxFilled]}
            value={digit} maxLength={1} keyboardType="number-pad"
            textAlign="center" textContentType="oneTimeCode" selectTextOnFocus
            onChangeText={(v) => onOtpChange(v, i)}
            onKeyPress={({ nativeEvent }: any) => onOtpKey(nativeEvent.key, i)}
          />
        ))}
      </View>
      {!!otpError && <ErrorLine text={otpError} />}

      <View style={s.resendRow}>
        {countdown > 0
          ? <Text style={s.resendMuted}>{t('Resend in', 'ಪುನಃ ಕಳುಹಿಸಿ')} 0:{String(countdown).padStart(2, '0')}</Text>
          : <TouchableOpacity><Text style={s.resendLink}>{t('Resend OTP', 'OTP ಪುನಃ ಕಳುಹಿಸಿ')}</Text></TouchableOpacity>
        }
      </View>

      <TouchableOpacity onPress={onVerify} disabled={verifying} activeOpacity={0.9} style={{ marginTop: 16 }}>
        <LinearGradient colors={[C.primaryBright, C.primaryDark]} style={s.primaryBtn}>
          {verifying ? <ActivityIndicator color="#FFF" />
            : (<><Text style={s.primaryBtnText}>{t('Verify & Continue', 'ಪರಿಶೀಲಿಸಿ')}</Text>
                 <Ionicons name="checkmark-circle" size={15} color="#FFF" /></>)}
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

// ═══ STEP: Name ════════════════════════════════════════════════════════════
function NameStep({ t, name, setName, onNext }: any) {
  return (
    <View>
      <View style={s.stepHeaderRow}>
        <View style={s.stepIconBox}>
          <Feather name="user" size={16} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>{t("What's your name?", 'ನಿಮ್ಮ ಹೆಸರೇನು?')}</Text>
          <Text style={s.stepSub}>{t("We'll personalize your farm dashboard", 'ನಿಮ್ಮ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ವೈಯಕ್ತೀಕರಿಸುತ್ತೇವೆ')}</Text>
        </View>
      </View>

      <Text style={s.fieldLabel}>{t('Full Name', 'ಪೂರ್ಣ ಹೆಸರು')}</Text>
      <View style={s.textInputWrap}>
        <Feather name="user" size={13} color={C.textLight} />
        <TextInput
          style={s.textInput}
          placeholder={t('e.g. Ramesh Gowda', 'ಉದಾ. ರಮೇಶ್ ಗೌಡ')}
          placeholderTextColor="#9CA8A1"
          value={name} onChangeText={setName}
          autoCapitalize="words" returnKeyType="done" autoFocus
          onSubmitEditing={onNext}
        />
      </View>

      <TouchableOpacity onPress={onNext} activeOpacity={0.9} style={{ marginTop: 18 }}>
        <LinearGradient colors={[C.primaryBright, C.primaryDark]} style={s.primaryBtn}>
          <Text style={s.primaryBtnText}>{t('Next', 'ಮುಂದೆ')}</Text>
          <Ionicons name="arrow-forward" size={15} color="#FFF" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

// ═══ STEP: Location ════════════════════════════════════════════════════════
function LocationStep({ t, locName, setLocName, fetching, onAutoFetch, onBack, onNext }: any) {
  return (
    <View>
      <View style={s.stepHeaderRow}>
        <TouchableOpacity style={s.backBtnSmall} onPress={onBack}>
          <Feather name="chevron-left" size={14} color={C.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>{t('Where is your farm?', 'ನಿಮ್ಮ ಜಮೀನು ಎಲ್ಲಿದೆ?')}</Text>
          <Text style={s.stepSub}>{t('For weather & nearby buyers', 'ಹವಾಮಾನ & ಹತ್ತಿರದ ಖರೀದಿದಾರರಿಗಾಗಿ')}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={s.gpsBtn} activeOpacity={0.85}
        onPress={onAutoFetch} disabled={fetching}
      >
        <View style={s.gpsIconBox}>
          {fetching ? <ActivityIndicator color={C.primary} size="small" />
            : <MaterialCommunityIcons name="crosshairs-gps" size={16} color={C.primary} />}
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.gpsTitle}>{t('Use my GPS location', 'ನನ್ನ GPS ಸ್ಥಳ ಬಳಸಿ')}</Text>
          <Text style={s.gpsSub}>{t('Auto-detect from map', 'ನಕ್ಷೆಯಿಂದ ಸ್ವಯಂ-ಪತ್ತೆ')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.textLight} />
      </TouchableOpacity>

      <View style={s.divider}>
        <View style={s.dividerLine} />
        <Text style={s.dividerText}>{t('OR ENTER MANUALLY', 'ಅಥವಾ ಕೈಯಿಂದ ನಮೂದಿಸಿ')}</Text>
        <View style={s.dividerLine} />
      </View>

      <Text style={s.fieldLabel}>{t('Village / Town', 'ಗ್ರಾಮ / ಪಟ್ಟಣ')}</Text>
      <View style={s.textInputWrap}>
        <Ionicons name="location-outline" size={13} color={C.textLight} />
        <TextInput
          style={s.textInput}
          placeholder={t('e.g. Malur, Kolar', 'ಉದಾ. ಮಾಲೂರು, ಕೋಲಾರ')}
          placeholderTextColor="#9CA8A1"
          value={locName} onChangeText={setLocName}
          autoCapitalize="words" returnKeyType="done" onSubmitEditing={onNext}
        />
      </View>

      <TouchableOpacity onPress={onNext} activeOpacity={0.9} style={{ marginTop: 18 }}>
        <LinearGradient colors={[C.primaryBright, C.primaryDark]} style={s.primaryBtn}>
          <Text style={s.primaryBtnText}>{t('Next', 'ಮುಂದೆ')}</Text>
          <Ionicons name="arrow-forward" size={15} color="#FFF" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

// ═══ STEP: Land (final step) ═══════════════════════════════════════════════
// This is now the last step in the wizard — no more "crops" step after it.
// The button label reflects that: "Finish" instead of "Next".
function LandStep({ t, landHa, setLandHa, saving, onBack, onNext }: any) {
  return (
    <View>
      <View style={s.stepHeaderRow}>
        <TouchableOpacity style={s.backBtnSmall} onPress={onBack}>
          <Feather name="chevron-left" size={14} color={C.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>{t('Total farm size?', 'ಒಟ್ಟು ಜಮೀನಿನ ಗಾತ್ರ?')}</Text>
          <Text style={s.stepSub}>{t('In hectares (1 ha ≈ 2.47 acres)', 'ಹೆಕ್ಟೇರ್‌ಗಳಲ್ಲಿ (1 ha ≈ 2.47 ಎಕರೆ)')}</Text>
        </View>
      </View>

      <Text style={s.fieldLabel}>{t('Land in Hectares', 'ಹೆಕ್ಟೇರ್‌ಗಳಲ್ಲಿ ಜಮೀನು')}</Text>
      <View style={s.textInputWrap}>
        <MaterialCommunityIcons name="sprout" size={14} color={C.textLight} />
        <TextInput
          style={s.textInput}
          placeholder="e.g. 2.5" placeholderTextColor="#9CA8A1"
          value={landHa} onChangeText={setLandHa}
          keyboardType="decimal-pad" returnKeyType="done" autoFocus
          onSubmitEditing={saving ? undefined : onNext}
        />
        <Text style={s.unitLabel}>ha</Text>
      </View>

      {/* Hint: crops are collected later from Business tab, not here. */}
      <View style={{ marginTop: 10, flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <Ionicons name="information-circle-outline" size={13} color={C.textMuted} style={{ marginTop: 1 }} />
        <Text style={{ fontSize: 11, color: C.textMuted, flex: 1, lineHeight: 15 }}>
          {t(
            "You'll add crops later from the Business tab as you log each season.",
            'ಪ್ರತಿ ಋತು ದಾಖಲಿಸುವಾಗ ವ್ಯಾಪಾರ ಟ್ಯಾಬ್‌ನಿಂದ ಬೆಳೆಗಳನ್ನು ಸೇರಿಸುತ್ತೀರಿ.'
          )}
        </Text>
      </View>

      <TouchableOpacity onPress={onNext} disabled={saving} activeOpacity={0.9} style={{ marginTop: 18 }}>
        <LinearGradient colors={[C.primaryBright, C.primaryDark]} style={s.primaryBtn}>
          {saving ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Text style={s.primaryBtnText}>{t('Finish', 'ಮುಗಿಸಿ')}</Text>
              <Ionicons name="checkmark-circle" size={15} color="#FFF" />
            </>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

// ═══ Helpers ═══════════════════════════════════════════════════════════════
function ErrorLine({ text }: { text: string }) {
  return (
    <View style={s.errorRow}>
      <Ionicons name="alert-circle" size={11} color={C.red} />
      <Text style={s.errorText}>{text}</Text>
    </View>
  );
}

// ═══ Styles ════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, minHeight: '100%' },

  // Hero
  hero: {
    paddingTop: Platform.OS === 'ios' ? 70 : 56,
    paddingBottom: 30,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(45,106,79,0.15)',
  },
  logoName: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.textDark, letterSpacing: -0.3 },
  logoKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 0 },
  langBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(45,106,79,0.15)',
  },
  langText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primaryDark },

  tagline: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 22, lineHeight: 28,
    letterSpacing: -0.5, marginTop: 22,
  },
  tagSub: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textBody,
    marginTop: 6, lineHeight: 16,
  },
  featureRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  featurePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(45,106,79,0.15)',
  },
  featurePillIcon: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: C.primaryPale,
    alignItems: 'center', justifyContent: 'center',
  },
  featurePillText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.textDark },

  // Card
  card: {
    marginHorizontal: 16, marginTop: -16, padding: 18,
    backgroundColor: C.card, borderRadius: 22,
    borderWidth: 1, borderColor: '#E8ECE9',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },

  progress: { flexDirection: 'row', gap: 4, marginBottom: 16 },
  progressBar: { height: 3, borderRadius: 2 },

  stepHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 10 },
  stepIconBox: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: C.primaryPale,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnSmall: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  stepTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: C.textDark, letterSpacing: -0.2 },
  stepSub: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textMuted, marginTop: 2 },

  fieldLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textDark, marginBottom: 4 },
  fieldHint: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted, marginBottom: 8 },

  // Phone input
  phoneRow: { flexDirection: 'row', gap: 6 },
  flagBox: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryTint, paddingHorizontal: 10, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, height: 44,
  },
  dialCode: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },
  phoneInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF', borderRadius: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border, height: 44,
  },
  phoneInput: {
    flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.textDark,
    letterSpacing: 0.5, padding: 0,
  },

  // General text input
  textInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF', borderRadius: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border, height: 44,
  },
  textInput: {
    flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, color: C.textDark, padding: 0,
  },
  unitLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textMuted },
  inputWrapError: { borderColor: C.red },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, paddingHorizontal: 2 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.red, flex: 1 },

  // Primary button
  primaryBtn: {
    height: 48, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowColor: C.primaryDark, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  primaryBtnText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: '#FFF', letterSpacing: 0.3 },

  // OTP
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  otpBox: {
    width: 40, height: 50, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: '#FAFBFA',
    fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.textDark,
  },
  otpBoxFilled: { borderColor: C.primary, backgroundColor: C.primaryTint },
  resendRow: { alignItems: 'center', marginTop: 12 },
  resendMuted: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textLight },
  resendLink: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary },

  // Location
  gpsBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.primaryTint, borderWidth: 1, borderColor: '#B7E4C7',
    borderRadius: 12, padding: 12,
  },
  gpsIconBox: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
  },
  gpsTitle: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },
  gpsSub: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted, marginTop: 1 },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.textLight, letterSpacing: 0.5 },

  // Crops
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FAFBFA', borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  presetChipAdded: { backgroundColor: C.primaryTint, borderColor: '#B7E4C7' },
  presetText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.textDark },
  presetTextAdded: { color: C.primary },

  cropRow: {
    backgroundColor: '#FAFBFA', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  cropRowKn: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted },
  cropRowMain: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  cropRowName: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },
  cropHaWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF', borderRadius: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: C.border, height: 34, width: 80,
  },
  cropHaInput: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark, padding: 0 },
  cropHaUnit: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },
  cropRemove: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 28 : 20,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  footerDivider: {
    width: 40, height: 3, borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 14,
  },
  safetyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryTint,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  safetyText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: C.primary },
  terms: {
    fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted,
    textAlign: 'center', marginTop: 10, paddingHorizontal: 20, lineHeight: 15,
  },
  termsLink: { fontFamily: 'Inter_700Bold', color: C.primary },
});
