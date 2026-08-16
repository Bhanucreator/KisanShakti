import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Animated, Easing, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafeGradient as LinearGradient } from '../../components/safe-gradient';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/use-auth';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Modern dark-green palette (weather.png inspired) ────────────────────────
const C = {
  bg: '#F5F7F5',
  dark: '#0F1F17',
  darkCard: '#1A2E23',
  darkCardLight: '#243B2E',
  green: '#2D6A4F',
  greenBright: '#40916C',
  greenNeon: '#52B788',
  greenPale: '#D8F3DC',
  greenTint: '#F0FDF4',
  amber: '#F59E0B',
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

type MarketItem = { crop: string; kn: string; price: number; change: number };

const MARKET_PRICES: MarketItem[] = [
  { crop: 'Tomato', kn: 'ಟೊಮ್ಯಾಟೊ', price: 18, change: 5 },
  { crop: 'Onion',  kn: 'ಈರುಳ್ಳಿ',   price: 22, change: -3 },
  { crop: 'Ragi',   kn: 'ರಾಗಿ',      price: 35, change: 0 },
  { crop: 'Potato', kn: 'ಆಲೂಗಡ್ಡೆ',  price: 15, change: 2 },
  { crop: 'Chili',  kn: 'ಮೆಣಸಿನಕಾಯಿ', price: 42, change: 8 },
];

// ── Animated sun ────────────────────────────────────────────────────────────
function AnimatedSun() {
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse  = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 16000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.15, duration: 2200, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 2200, useNativeDriver: true }),
    ])).start();
  }, []);
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={su.wrap} pointerEvents="none">
      <Animated.View style={[su.glow, { transform: [{ scale: pulse }] }]} />
      <Animated.View style={[su.rays, { transform: [{ rotate: spin }] }]}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
          <View key={a} style={[su.ray, { transform: [{ rotate: `${a}deg` }, { translateY: -22 }] }]} />
        ))}
      </Animated.View>
      <View style={su.core} />
    </View>
  );
}
const su = StyleSheet.create({
  wrap: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(251,191,36,0.3)' },
  rays: { position: 'absolute', width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 2, height: 8, borderRadius: 1, backgroundColor: '#FBBF24' },
  core: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F59E0B', borderWidth: 2, borderColor: '#FBBF24' },
});

// ── Home Screen ─────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const auth = useAuth();
  const displayName = (auth.farmerName ?? 'Farmer').split(' ')[0];
  const [showProfile, setShowProfile] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={h.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={h.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top Bar: Avatar + Settings (no bell) ── */}
          <View style={h.topBar}>
            <TouchableOpacity
              onPress={() => setShowProfile(true)}
              activeOpacity={0.7}
              style={h.avatarRow}
            >
              <View style={h.avatar}>
                <Text style={h.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ marginLeft: 10 }}>
                <Text style={h.hi}>Namaskara 🌿</Text>
                <Text style={h.name}>{displayName}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={h.settingsBtn}
              activeOpacity={0.7}
              onPress={() => setShowProfile(true)}
            >
              <Feather name="settings" size={16} color={C.textDark} />
            </TouchableOpacity>
          </View>

          {/* ── Farmer Profile Card ── */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setShowProfile(true)}
            style={h.profileCard}
          >
            <View style={{ flex: 1 }}>
              <View style={h.profileTopRow}>
                <View style={h.profileBadge}>
                  <MaterialCommunityIcons name="account-check" size={11} color={C.greenNeon} />
                  <Text style={h.profileBadgeText}>My Farm</Text>
                </View>
                <Text style={h.profileKn}>ನನ್ನ ಜಮೀನು</Text>
              </View>
              <Text style={h.profileName}>{auth.farmerName ?? displayName}</Text>
              <View style={h.profileMetaRow}>
                <View style={h.metaChip}>
                  <MaterialCommunityIcons name="phone-outline" size={11} color="#95D5B2" />
                  <Text style={h.metaChipText}>{auth.phone ?? '+91 xxxxx'}</Text>
                </View>
                <View style={h.metaChip}>
                  <Ionicons name="location-outline" size={11} color="#95D5B2" />
                  <Text style={h.metaChipText}>Kolar, KA</Text>
                </View>
              </View>
              <View style={h.profileStatsRow}>
                <ProfileStat label="Land" value="2.5" unit="ha" />
                <View style={h.statDivider} />
                <ProfileStat label="Crops" value="3" unit="types" />
                <View style={h.statDivider} />
                <ProfileStat label="Cattle" value="3" unit="head" />
              </View>
            </View>
          </TouchableOpacity>

          {/* ── Market Prices (moved to top per spec) ── */}
          <View style={h.sectionHeader}>
            <View>
              <Text style={h.sectionTitle}>Market Prices</Text>
              <Text style={h.sectionKn}>ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/market')} activeOpacity={0.7}>
              <Text style={h.viewAll}>View all →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 16 }}
            style={{ marginHorizontal: -16 }}
          >
            <View style={{ width: 16 }} />
            {MARKET_PRICES.map((item) => (
              <MarketCard key={item.crop} item={item} onPress={() => router.push('/(tabs)/market')} />
            ))}
          </ScrollView>

          {/* ── Weather Card (dark-green fintech style) ── */}
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => router.push('/(tabs)/weather')}
            style={h.weatherCardWrap}
          >
            <LinearGradient
              colors={['#1A2E23', '#0F1F17']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={h.weatherCard}
            >
              <View style={h.weatherLeft}>
                <View style={h.weatherLocRow}>
                  <View style={h.liveDot} />
                  <Text style={h.weatherLoc}>Malur, Kolar · Live</Text>
                </View>
                <Text style={h.weatherTemp}>28°</Text>
                <Text style={h.weatherCond}>Sunny · Perfect for spraying</Text>
                <Text style={h.weatherCondKn}>ಸ್ಪ್ರೇಗೆ ಸೂಕ್ತ</Text>
              </View>
              <View style={h.weatherRight}>
                <AnimatedSun />
                <View style={h.weatherMetrics}>
                  <MetricPill icon="water-outline" value="62%" />
                  <MetricPill icon="cloud-outline" value="0%" />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Today's Insight ── */}
          <View style={h.sectionHeader}>
            <View>
              <Text style={h.sectionTitle}>Today's Insight</Text>
              <Text style={h.sectionKn}>ಇಂದಿನ ಒಳನೋಟ</Text>
            </View>
          </View>

          <View style={h.insightCard}>
            <View style={h.insightIconBox}>
              <FontAwesome5 name="seedling" size={16} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={h.insightBadge}>
                <Ionicons name="trending-up" size={9} color={C.green} />
                <Text style={h.insightBadgeText}>+34% profit expected</Text>
              </View>
              <Text style={h.insightTitle}>Grow Maize in Plot B this season</Text>
              <Text style={h.insightSub}>Based on current market trends</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textLight} />
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ── Profile Modal ── */}
      <ProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
        auth={auth}
      />
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function ProfileStat({ label, value, unit }: any) {
  return (
    <View style={h.stat}>
      <Text style={h.statValue}>{value} <Text style={h.statUnit}>{unit}</Text></Text>
      <Text style={h.statLabel}>{label}</Text>
    </View>
  );
}

function MetricPill({ icon, value }: any) {
  return (
    <View style={h.metricPill}>
      <Ionicons name={icon} size={11} color="#95D5B2" />
      <Text style={h.metricPillText}>{value}</Text>
    </View>
  );
}

function MarketCard({ item, onPress }: any) {
  const isUp = item.change > 0;
  const isDown = item.change < 0;
  const color = isUp ? C.green : isDown ? C.red : C.amber;
  const bg = isUp ? C.greenPale : isDown ? C.redBg : C.amberBg;

  return (
    <TouchableOpacity style={h.mkCard} activeOpacity={0.85} onPress={onPress}>
      <View style={h.mkTopRow}>
        <View>
          <Text style={h.mkCrop}>{item.crop}</Text>
          <Text style={h.mkKn}>{item.kn}</Text>
        </View>
        <View style={[h.mkPill, { backgroundColor: bg }]}>
          <Ionicons
            name={isUp ? 'trending-up' : isDown ? 'trending-down' : 'remove'}
            size={9} color={color}
          />
          <Text style={[h.mkPillText, { color }]}>{Math.abs(item.change)}%</Text>
        </View>
      </View>
      <Text style={h.mkPrice}>₹{item.price}<Text style={h.mkPriceUnit}>/kg</Text></Text>
      <View style={h.mkSparkline}>
        {[0.4, 0.6, 0.5, 0.7, 0.9, 0.75, isUp ? 1 : isDown ? 0.3 : 0.7].map((v, i) => (
          <View
            key={i}
            style={{
              flex: 1, marginHorizontal: 1, height: v * 20, borderRadius: 1.5,
              backgroundColor: color, opacity: 0.15 + v * 0.7,
            }}
          />
        ))}
      </View>
    </TouchableOpacity>
  );
}

function ProfileModal({ visible, onClose, auth }: any) {
  const slide = useRef(new Animated.Value(600)).current;
  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : 600,
      damping: 22, stiffness: 180, useNativeDriver: true,
    }).start();
  }, [visible]);

  const displayName = auth.farmerName ?? 'Farmer';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={p.backdrop} onPress={onClose} />
      <Animated.View style={[p.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={p.handle} />
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {/* Big avatar header */}
          <View style={p.avatarHero}>
            <View style={p.bigAvatar}>
              <Text style={p.bigAvatarText}>{displayName.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={p.bigName}>{displayName}</Text>
            <View style={p.roleBadge}>
              <MaterialCommunityIcons name="account-check" size={10} color={C.green} />
              <Text style={p.roleText}>Verified Farmer · ರೈತ</Text>
            </View>
          </View>

          {/* Personal Info */}
          <Text style={p.sectionLabel}>Personal Information</Text>
          <View style={p.infoCard}>
            <InfoRow icon="phone-portrait-outline" label="Mobile" value={auth.phone ?? '+91 —'} />
            <View style={p.divider} />
            <InfoRow icon="location-outline" label="Location" value="Malur, Kolar, Karnataka" />
            <View style={p.divider} />
            <InfoRow icon="id-card-outline" label="Farmer ID" value={auth.farmerId?.slice(0, 8) ?? '—'} />
          </View>

          {/* Farm Details */}
          <Text style={p.sectionLabel}>Farm Details · ಜಮೀನಿನ ವಿವರಗಳು</Text>
          <View style={p.infoCard}>
            <InfoRow icon="leaf-outline" label="Total Land" value="2.5 hectares" />
            <View style={p.divider} />
            <InfoRow icon="sparkles-outline" label="Current Crops" value="Tomato, Ragi, Potato" />
            <View style={p.divider} />
            <InfoRow icon="paw-outline" label="Livestock" value="2 Cows, 1 Goat" />
          </View>

          {/* Settings */}
          <Text style={p.sectionLabel}>Settings</Text>
          <View style={p.infoCard}>
            <SettingRow icon="language-outline" label="Language" value="English + ಕನ್ನಡ" />
            <View style={p.divider} />
            <SettingRow icon="notifications-outline" label="Notifications" value="On" />
            <View style={p.divider} />
            <SettingRow icon="cloud-download-outline" label="Offline Data" value="Enabled" />
          </View>

          <TouchableOpacity
            style={p.logoutBtn}
            activeOpacity={0.8}
            onPress={async () => {
              await auth.signOut();
              onClose();
              router.replace('/login');
            }}
          >
            <Ionicons name="log-out-outline" size={16} color={C.red} />
            <Text style={p.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function InfoRow({ icon, label, value }: any) {
  return (
    <View style={p.infoRow}>
      <View style={p.infoIcon}><Ionicons name={icon} size={14} color={C.green} /></View>
      <View style={{ flex: 1 }}>
        <Text style={p.infoLabel}>{label}</Text>
        <Text style={p.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function SettingRow({ icon, label, value }: any) {
  return (
    <View style={p.infoRow}>
      <View style={p.infoIcon}><Ionicons name={icon} size={14} color={C.green} /></View>
      <View style={{ flex: 1 }}>
        <Text style={p.infoLabel}>{label}</Text>
      </View>
      <Text style={p.settingValue}>{value}</Text>
      <Ionicons name="chevron-forward" size={14} color={C.textLight} style={{ marginLeft: 4 }} />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const h = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingBottom: 20 },

  // Top bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 12 },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#FFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  hi: { fontFamily: 'Inter_400Regular', fontSize: 11, color: C.textMuted },
  name: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textDark, marginTop: 1 },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // Profile card
  profileCard: {
    backgroundColor: C.dark, borderRadius: 20, padding: 16,
    marginBottom: 20, borderWidth: 1, borderColor: '#22382C',
  },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  profileBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(82, 183, 136, 0.15)',
    borderWidth: 1, borderColor: 'rgba(82, 183, 136, 0.3)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
  },
  profileBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.greenNeon },
  profileKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: '#7A8B85' },
  profileName: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: '#FFF', marginTop: 8, letterSpacing: -0.3 },
  profileMetaRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  metaChipText: { fontFamily: 'Inter_500Medium', fontSize: 10, color: 'rgba(255,255,255,0.75)' },
  profileStatsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, padding: 10, marginTop: 12,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#FFF' },
  statUnit: { fontFamily: 'Inter_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.5)' },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.1)' },

  // Sections
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginTop: 20, marginBottom: 10,
  },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.textDark, letterSpacing: -0.2 },
  sectionKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 1 },
  viewAll: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.green },

  // Market cards (compact)
  mkCard: {
    width: 120, backgroundColor: C.card, borderRadius: 14, padding: 10,
    marginRight: 8, borderWidth: 1, borderColor: C.border,
  },
  mkTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  mkCrop: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark },
  mkKn: { fontFamily: 'Inter_400Regular', fontSize: 9, color: C.textMuted, marginTop: 1 },
  mkPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },
  mkPillText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  mkPrice: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: C.textDark, marginTop: 6, letterSpacing: -0.3 },
  mkPriceUnit: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },
  mkSparkline: { flexDirection: 'row', alignItems: 'flex-end', height: 22, marginTop: 8 },

  // Weather card
  weatherCardWrap: {
    borderRadius: 20, overflow: 'hidden', marginTop: 6,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  weatherCard: { padding: 16, flexDirection: 'row' },
  weatherLeft: { flex: 1 },
  weatherLocRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#DC2626' },
  weatherLoc: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: 'rgba(255,255,255,0.65)' },
  weatherTemp: { fontFamily: 'Inter_800ExtraBold', fontSize: 46, color: '#FFF', letterSpacing: -2, marginTop: 4 },
  weatherCond: { fontFamily: 'Inter_700Bold', fontSize: 12, color: '#FFF', marginTop: -3 },
  weatherCondKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  weatherRight: { alignItems: 'flex-end', justifyContent: 'space-between' },
  weatherMetrics: { gap: 4, marginTop: 8 },
  metricPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  metricPillText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: '#FFF' },

  // Insight
  insightCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 14, padding: 12, gap: 12, marginTop: 10,
    borderWidth: 1, borderColor: C.border,
  },
  insightIconBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: C.greenPale,
    alignItems: 'center', justifyContent: 'center',
  },
  insightBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start' },
  insightBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.green },
  insightTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: C.textDark, marginTop: 3 },
  insightSub: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted, marginTop: 1 },
});

const p = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%', paddingTop: 8,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D5DBD7', alignSelf: 'center', marginBottom: 4 },

  avatarHero: { alignItems: 'center', paddingVertical: 20 },
  bigAvatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.green, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  bigAvatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, color: '#FFF' },
  bigName: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.textDark, marginTop: 12, letterSpacing: -0.3 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.greenPale, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: 6,
  },
  roleText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.green },

  sectionLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 18, marginBottom: 8, paddingHorizontal: 20,
  },
  infoCard: {
    backgroundColor: C.card, borderRadius: 14, marginHorizontal: 16,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  infoIcon: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: C.greenTint,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  infoLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },
  infoValue: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark, marginTop: 2 },
  settingValue: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted },
  divider: { height: 1, backgroundColor: C.border, marginLeft: 54 },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 20,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.redBg, borderWidth: 1, borderColor: '#FCA5A5',
  },
  logoutText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.red },
});
