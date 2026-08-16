import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Animated, Easing, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafeGradient as LinearGradient } from '../../components/safe-gradient';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/use-auth';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Palette (matches Frontend Guidelines) ───────────────────────────────────
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
  blue: '#2563EB',
  blueBg: '#DBEAFE',
  bg: '#F8F9FA',
  card: '#FFFFFF',
  border: '#E5E7EB',
  textDark: '#111827',
  textBody: '#374151',
  textMuted: '#6B7A99',
  textLight: '#9CA3AF',
  shadow: 'rgba(0,0,0,0.06)',
};

type MarketItem = { crop: string; kn: string; price: number; change: number; };
const MARKET_PRICES: MarketItem[] = [
  { crop: 'Tomato',   kn: 'ಟೊಮ್ಯಾಟೊ',  price: 18, change: 5 },
  { crop: 'Onion',    kn: 'ಈರುಳ್ಳಿ',    price: 22, change: -3 },
  { crop: 'Ragi',     kn: 'ರಾಗಿ',       price: 35, change: 0 },
  { crop: 'Potato',   kn: 'ಆಲೂಗಡ್ಡೆ',   price: 15, change: 2 },
];

// ── Animated sun ────────────────────────────────────────────────────────────
function AnimatedSun() {
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.2, duration: 2200, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 2200, useNativeDriver: true }),
    ])).start();
  }, []);
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={su.wrap} pointerEvents="none">
      <Animated.View style={[su.glow, { transform: [{ scale: pulse }] }]} />
      <Animated.View style={[su.rays, { transform: [{ rotate: spin }] }]}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
          <View key={a} style={[su.ray, { transform: [{ rotate: `${a}deg` }, { translateY: -34 }] }]} />
        ))}
      </Animated.View>
      <View style={su.core} />
    </View>
  );
}
const su = StyleSheet.create({
  wrap: { position: 'absolute', right: 20, top: 20, width: 82, height: 82, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(251,191,36,0.35)' },
  rays: { position: 'absolute', width: 68, height: 68, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 3, height: 12, borderRadius: 1.5, backgroundColor: '#FBBF24' },
  core: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F59E0B', borderWidth: 2.5, borderColor: '#FBBF24' },
});

// ── Home Screen ─────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const auth = useAuth();
  const displayName = (auth.farmerName ?? 'Farmer').split(' ')[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={h.safe} edges={['top']}>
        <ScrollView contentContainerStyle={h.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Top Bar ── */}
          <View style={h.topBar}>
            <View style={h.avatar}>
              <Text style={h.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={h.greeting}>Namaskara, {displayName} 🌿</Text>
              <View style={h.locRow}>
                <Ionicons name="location" size={11} color={C.textMuted} />
                <Text style={h.loc}>Kolar, Karnataka</Text>
              </View>
            </View>
            <TouchableOpacity style={h.bellBtn} activeOpacity={0.7}>
              <Ionicons name="notifications-outline" size={20} color={C.textDark} />
              <View style={h.bellDot} />
            </TouchableOpacity>
          </View>

          {/* ── Weather Hero Card ── */}
          <LinearGradient
            colors={['#B8E1CC', '#95D5B2', '#74C69D']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={h.weatherCard}
          >
            <AnimatedSun />

            <View style={h.weatherLocRow}>
              <MaterialCommunityIcons name="map-marker" size={14} color={C.primaryDark} />
              <Text style={h.weatherLoc}>Malur, Kolar</Text>
              <View style={h.weatherLiveDot} />
              <Text style={h.weatherLive}>Live</Text>
            </View>

            <Text style={h.weatherTemp}>28°</Text>
            <Text style={h.weatherCond}>Sunny · Perfect for spraying</Text>
            <Text style={h.weatherKn}>ಸ್ಪ್ರೇಗೆ ಸೂಕ್ತ</Text>

            <View style={h.weatherMetricsRow}>
              <WeatherMetric icon="water" label="Humidity" value="62%" />
              <View style={h.metricDivider} />
              <WeatherMetric icon="weather-windy" label="Wind" value="8 km/h" />
              <View style={h.metricDivider} />
              <WeatherMetric icon="weather-rainy" label="Rain" value="0%" />
            </View>
          </LinearGradient>

          {/* ── Quick Actions Grid ── */}
          <Text style={h.sectionTitle}>Quick Actions</Text>
          <Text style={h.sectionTitleKn}>ತ್ವರಿತ ಕ್ರಿಯೆಗಳು</Text>

          <View style={h.actionGrid}>
            <QuickAction
              icon="scan" iconLib="mci" iconName="line-scan"
              gradient={['#40916C', '#2D6A4F']}
              label="Scan Disease" kn="ರೋಗ ಸ್ಕ್ಯಾನ್"
              onPress={() => router.push('/(tabs)/disease')}
            />
            <QuickAction
              icon="storefront" iconLib="ion"
              gradient={['#F59E0B', '#D97706']}
              label="Sell Produce" kn="ಬೆಳೆ ಮಾರಾಟ"
              onPress={() => router.push('/(tabs)/market')}
            />
            <QuickAction
              icon="thermometer" iconLib="ion"
              gradient={['#3B82F6', '#2563EB']}
              label="Soil Sensor" kn="ಮಣ್ಣಿನ ಸಂವೇದಕ"
              onPress={() => router.push('/(tabs)/weather')}
            />
            <QuickAction
              icon="analytics" iconLib="ion"
              gradient={['#8B5CF6', '#6D28D9']}
              label="Farm Ledger" kn="ಆದಾಯ-ವೆಚ್ಚ"
              onPress={() => router.push('/(tabs)/ledger')}
            />
          </View>

          {/* ── Farm Overview ── */}
          <View style={h.sectionRow}>
            <View>
              <Text style={h.sectionTitle}>My Farm</Text>
              <Text style={h.sectionTitleKn}>ನನ್ನ ಜಮೀನು</Text>
            </View>
          </View>

          <View style={h.farmOverviewRow}>
            <OverviewCard icon="sprout" iconLib="mci" tint="#E8F5E9" label="Land" value="2.5 ha" />
            <OverviewCard icon="seedling" iconLib="fa5" tint="#FEF3C7" label="Crops" value="3 types" />
            <OverviewCard icon="cow" iconLib="mci" tint="#DBEAFE" label="Livestock" value="3" />
          </View>

          {/* ── Market Prices ── */}
          <View style={h.sectionRow}>
            <View>
              <Text style={h.sectionTitle}>Market Prices</Text>
              <Text style={h.sectionTitleKn}>ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/market')} activeOpacity={0.7}>
              <Text style={h.viewAll}>View All →</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
            {MARKET_PRICES.map((item) => (
              <MarketCard key={item.crop} item={item} />
            ))}
          </ScrollView>

          {/* ── Smart Suggestion ── */}
          <Text style={[h.sectionTitle, { marginTop: 24 }]}>Today's Insight</Text>
          <Text style={h.sectionTitleKn}>ಇಂದಿನ ಒಳನೋಟ</Text>

          <LinearGradient
            colors={['#F0FDF4', '#D8F3DC']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={h.insightCard}
          >
            <View style={h.insightIconBox}>
              <FontAwesome5 name="seedling" size={22} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={h.insightBadge}>
                <Ionicons name="trending-up" size={11} color={C.primary} />
                <Text style={h.insightBadgeText}>34% higher profit expected</Text>
              </View>
              <Text style={h.insightTitle}>Grow Maize in Plot B this season</Text>
              <Text style={h.insightSub}>
                Based on current market trends and your soil conditions
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.primary} />
          </LinearGradient>

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function WeatherMetric({ icon, label, value }: any) {
  return (
    <View style={h.wMetric}>
      <MaterialCommunityIcons name={icon} size={16} color={C.primaryDark} />
      <Text style={h.wMetricValue}>{value}</Text>
      <Text style={h.wMetricLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon, iconLib, iconName, gradient, label, kn, onPress }: any) {
  const Icon = iconLib === 'mci' ? MaterialCommunityIcons : iconLib === 'fa5' ? FontAwesome5 : Ionicons;
  const finalIcon = iconName ?? icon;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={h.qaCard}>
      <LinearGradient colors={gradient} style={h.qaIconBox} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <Icon name={finalIcon} size={20} color="#FFF" />
      </LinearGradient>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={h.qaLabel}>{label}</Text>
        <Text style={h.qaKn}>{kn}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textLight} />
    </TouchableOpacity>
  );
}

function OverviewCard({ icon, iconLib, tint, label, value }: any) {
  const Icon = iconLib === 'mci' ? MaterialCommunityIcons : iconLib === 'fa5' ? FontAwesome5 : Ionicons;
  return (
    <View style={h.ovCard}>
      <View style={[h.ovIconBox, { backgroundColor: tint }]}>
        <Icon name={icon} size={18} color={C.primaryDark} />
      </View>
      <Text style={h.ovLabel}>{label}</Text>
      <Text style={h.ovValue}>{value}</Text>
    </View>
  );
}

function MarketCard({ item }: { item: MarketItem }) {
  const isUp = item.change > 0;
  const isDown = item.change < 0;
  const color = isUp ? C.primary : isDown ? C.red : C.amber;
  const bg = isUp ? C.primaryPale : isDown ? C.redBg : C.amberBg;

  return (
    <View style={h.mkCard}>
      <View style={h.mkTopRow}>
        <Text style={h.mkCrop}>{item.crop}</Text>
        <View style={[h.mkPill, { backgroundColor: bg }]}>
          <Ionicons
            name={isUp ? 'trending-up' : isDown ? 'trending-down' : 'remove'}
            size={10} color={color}
          />
          <Text style={[h.mkPillText, { color }]}>
            {Math.abs(item.change)}%
          </Text>
        </View>
      </View>
      <Text style={h.mkKn}>{item.kn}</Text>
      <Text style={h.mkPrice}>₹{item.price}<Text style={h.mkPriceUnit}>/kg</Text></Text>

      {/* Mini sparkline */}
      <View style={h.mkSparkline}>
        {[0.4, 0.6, 0.5, 0.7, 0.9, 0.75, isUp ? 1 : isDown ? 0.3 : 0.7].map((v, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              marginHorizontal: 1,
              height: v * 24,
              borderRadius: 2,
              backgroundColor: color,
              opacity: 0.15 + v * 0.7,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const h = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  // Top bar
  topBar: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 20 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  avatarText: { color: '#FFF', fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  greeting: { fontFamily: 'Inter_700Bold', fontSize: 16, color: C.textDark },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  loc: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted },
  bellBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  bellDot: { position: 'absolute', top: 11, right: 11, width: 7, height: 7, borderRadius: 4, backgroundColor: C.red, borderWidth: 1.5, borderColor: C.card },

  // Weather
  weatherCard: {
    borderRadius: 22, padding: 22, position: 'relative', overflow: 'hidden',
    marginBottom: 24,
    shadowColor: C.primaryDark, shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
  weatherLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weatherLoc: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primaryDark },
  weatherLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#DC2626', marginLeft: 8 },
  weatherLive: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primaryDark, marginLeft: 3 },
  weatherTemp: { fontFamily: 'Inter_800ExtraBold', fontSize: 56, color: C.primaryDark, letterSpacing: -2, marginTop: 6 },
  weatherCond: { fontFamily: 'Inter_700Bold', fontSize: 15, color: C.primaryDark, marginTop: -4 },
  weatherKn: { fontFamily: 'Inter_500Medium', fontSize: 12, color: 'rgba(27,67,50,0.7)', marginTop: 3 },

  weatherMetricsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 14,
    padding: 12, marginTop: 20,
  },
  wMetric: { flex: 1, alignItems: 'center', gap: 4 },
  wMetricValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.primaryDark },
  wMetricLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.primaryDark, opacity: 0.75 },
  metricDivider: { width: 1, height: 24, backgroundColor: 'rgba(27,67,50,0.15)' },

  // Sections
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.textDark, letterSpacing: -0.3 },
  sectionTitleKn: { fontFamily: 'Inter_500Medium', fontSize: 12, color: C.textMuted, marginTop: 1, marginBottom: 14 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
  viewAll: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },

  // Quick actions
  actionGrid: { gap: 10 },
  qaCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  qaIconBox: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  qaLabel: { fontFamily: 'Inter_700Bold', fontSize: 14, color: C.textDark },
  qaKn: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted, marginTop: 1 },

  // Farm overview
  farmOverviewRow: { flexDirection: 'row', gap: 10 },
  ovCard: {
    flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  ovIconBox: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ovLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted },
  ovValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.textDark, marginTop: 2 },

  // Market cards
  mkCard: {
    width: 140, backgroundColor: C.card, borderRadius: 14, padding: 12,
    marginRight: 10, borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  mkTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mkCrop: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textDark },
  mkKn: { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted, marginTop: 1 },
  mkPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  mkPillText: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  mkPrice: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, color: C.textDark, marginTop: 6, letterSpacing: -0.5 },
  mkPriceUnit: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted },
  mkSparkline: { flexDirection: 'row', alignItems: 'flex-end', height: 26, marginTop: 10 },

  // Insight
  insightCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, padding: 16, gap: 14, marginTop: 14,
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  insightIconBox: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  insightBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  insightBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary },
  insightTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.primaryDark, marginTop: 4 },
  insightSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.textBody, marginTop: 2, lineHeight: 17 },
});
