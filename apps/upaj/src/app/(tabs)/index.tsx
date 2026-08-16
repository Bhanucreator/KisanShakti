import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Dimensions, Animated, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../../constants/theme';

const { width } = Dimensions.get('window');

type MarketItem = {
  crop: string;
  price: string;
  change: string;
  type: 'up' | 'down' | 'neutral';
};

const MARKET_PRICES: MarketItem[] = [
  { crop: 'Tomato', price: '₹18/kg', change: '5%', type: 'up' },
  { crop: 'Onion', price: '₹22/kg', change: '3%', type: 'down' },
  { crop: 'Ragi', price: '₹35/kg', change: '0%', type: 'neutral' },
];

// ── Animated Falling Rain Drops Component ──────────────────────────────────
function AnimatedRainDrops() {
  const drops = Array.from({ length: 8 }).map((_, i) => ({
    id: i,
    anim: useRef(new Animated.Value(-20)).current,
    left: `${12 + i * 11}%`,
    duration: 700 + (i % 3) * 200,
    delay: i * 150,
  }));

  useEffect(() => {
    drops.forEach((drop) => {
      const animate = () => {
        drop.anim.setValue(-20);
        Animated.sequence([
          Animated.delay(drop.delay),
          Animated.timing(drop.anim, {
            toValue: 120,
            duration: drop.duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ]).start(() => animate());
      };
      animate();
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((drop) => (
        <Animated.View
          key={drop.id}
          style={[
            rainStyles.dropLine,
            {
              left: drop.left as any,
              transform: [{ translateY: drop.anim }, { rotate: '15deg' }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const rainStyles = StyleSheet.create({
  dropLine: {
    position: 'absolute',
    width: 2.5,
    height: 16,
    borderRadius: 1.5,
    backgroundColor: 'rgba(37, 99, 235, 0.75)',
  },
});

// ── Animated Rotating & Pulsing Sun Component ──────────────────────────────
function AnimatedSun() {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Rotation loop
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 10000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulse loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.15, duration: 2000, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={sunStyles.container} pointerEvents="none">
      {/* Outer Halo Glow */}
      <Animated.View style={[sunStyles.halo, { transform: [{ scale: scaleAnim }] }]} />

      {/* Rotating Sun Rays */}
      <Animated.View style={[sunStyles.raysContainer, { transform: [{ rotate: spin }] }]}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <View
            key={angle}
            style={[
              sunStyles.ray,
              { transform: [{ rotate: `${angle}deg` }, { translateY: -26 }] },
            ]}
          />
        ))}
      </Animated.View>

      {/* Sun Core Circle */}
      <View style={sunStyles.sunCore} />
    </View>
  );
}

const sunStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(251, 191, 36, 0.35)',
  },
  raysContainer: {
    position: 'absolute',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ray: {
    position: 'absolute',
    width: 3,
    height: 10,
    borderRadius: 1.5,
    backgroundColor: '#F59E0B',
  },
  sunCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F59E0B',
    borderWidth: 2,
    borderColor: '#FBBF24',
  },
});

export default function HomeScreen() {
  const [farmer] = useState({ name: 'Raju', land_ha: 2.5, crops: 'Tomato, Ragi', livestock: '2 Cows, 1 Goat' });
  const [weatherMode, setWeatherMode] = useState<'sunny' | 'raining'>('sunny');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Top Header ── */}
        <View style={styles.header}>
          <View>
            <View style={styles.nameRow}>
              <Text style={styles.greeting}>Namaskara, {farmer.name}</Text>
              <Text style={styles.leafEmoji}>🌿</Text>
            </View>
            <Text style={styles.locationText}>Kolar, Karnataka</Text>
          </View>
          <TouchableOpacity style={styles.bellBtn} activeOpacity={0.7}>
            <Ionicons name="notifications-outline" size={22} color={COLORS.textDark} />
            <View style={styles.bellBadge} />
          </TouchableOpacity>
        </View>

        {/* ── Weather Hero Card with Live Animations ── */}
        <View style={[
          styles.weatherCard,
          weatherMode === 'raining' ? { backgroundColor: '#DBEAFE', borderColor: '#BFDBFE' } : { backgroundColor: '#E2F1E5', borderColor: '#C8E6C9' }
        ]}>

          {/* Live Animations */}
          {weatherMode === 'raining' ? (
            <AnimatedRainDrops />
          ) : (
            <AnimatedSun />
          )}

          <View style={styles.weatherTop}>
            <View>
              <Text style={styles.weatherTemp}>
                {weatherMode === 'raining' ? '22°c' : '28°c'}
              </Text>
              <Text style={styles.weatherCond}>
                {weatherMode === 'raining' ? 'Heavy Rain' : 'Sunny Day'}
              </Text>
            </View>

            {/* Mode Switch Pill Toggle */}
            <TouchableOpacity
              style={styles.rainBadge}
              onPress={() => setWeatherMode(prev => prev === 'sunny' ? 'raining' : 'sunny')}
              activeOpacity={0.8}
            >
              <Ionicons
                name={weatherMode === 'raining' ? 'rainy' : 'sunny'}
                size={16}
                color={weatherMode === 'raining' ? COLORS.accentBlue : COLORS.accentAmber}
              />
              <View style={{ marginLeft: 6 }}>
                <Text style={styles.rainBadgeTitle}>
                  {weatherMode === 'raining' ? 'Raining Mode' : 'Sunny Mode'}
                </Text>
                <Text style={styles.rainBadgePct}>Tap to toggle</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Decorative subtle landscape illustration overlay */}
          <View style={styles.landscapeGraphic}>
            <Text style={{ fontSize: 36, opacity: 0.35 }}>
              {weatherMode === 'raining' ? '🌧️ 🌾 🚜' : '☀️ 🌾 🚜'}
            </Text>
          </View>
        </View>

        {/* ── Overview Cards Row ── */}
        <View style={styles.overviewRow}>
          {/* My Farm */}
          <View style={styles.overviewCard}>
            <View style={[styles.overviewIconBg, { backgroundColor: '#E8F5E9' }]}>
              <MaterialCommunityIcons name="sprout" size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.overviewTitle}>My Farm</Text>
            <Text style={styles.overviewSub}>{farmer.land_ha} ha</Text>
          </View>

          {/* Crops */}
          <View style={styles.overviewCard}>
            <View style={[styles.overviewIconBg, { backgroundColor: '#E8F5E9' }]}>
              <FontAwesome5 name="seedling" size={18} color={COLORS.primary} />
            </View>
            <Text style={styles.overviewTitle}>Crops</Text>
            <Text style={styles.overviewSub} numberOfLines={1}>{farmer.crops}</Text>
          </View>

          {/* Livestock */}
          <View style={styles.overviewCard}>
            <View style={[styles.overviewIconBg, { backgroundColor: '#E8F5E9' }]}>
              <MaterialCommunityIcons name="barn" size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.overviewTitle}>Livestock</Text>
            <Text style={styles.overviewSub} numberOfLines={1}>{farmer.livestock}</Text>
          </View>
        </View>

        {/* ── Market Prices Section ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Market Prices</Text>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.marketRow}>
          {MARKET_PRICES.map((item) => (
            <View key={item.crop} style={styles.marketCard}>
              <Text style={styles.marketCrop}>{item.crop}</Text>
              <Text style={styles.marketPrice}>{item.price}</Text>

              {/* Trend Pill */}
              <View style={[
                styles.trendBadge,
                item.type === 'up' && { backgroundColor: '#E8F5E9' },
                item.type === 'down' && { backgroundColor: '#FEE2E2' },
                item.type === 'neutral' && { backgroundColor: '#FEF3C7' },
              ]}>
                <Feather
                  name={item.type === 'up' ? 'trending-up' : item.type === 'down' ? 'trending-down' : 'minus'}
                  size={12}
                  color={item.type === 'up' ? COLORS.primary : item.type === 'down' ? COLORS.accentRed : COLORS.accentAmber}
                />
                <Text style={[
                  styles.trendText,
                  item.type === 'up' && { color: COLORS.primary },
                  item.type === 'down' && { color: COLORS.accentRed },
                  item.type === 'neutral' && { color: COLORS.accentAmber },
                ]}>
                  {item.change}
                </Text>
              </View>

              {/* Mini trend graphic */}
              <View style={styles.miniChartTrack}>
                <View style={[
                  styles.miniChartLine,
                  {
                    width: item.type === 'up' ? '85%' : item.type === 'down' ? '45%' : '65%',
                    backgroundColor: item.type === 'up' ? COLORS.primary : item.type === 'down' ? COLORS.accentRed : COLORS.accentAmber,
                    height: item.type === 'up' ? 3 : 2,
                  }
                ]} />
              </View>
            </View>
          ))}
        </View>

        {/* ── Smart Suggestions Card ── */}
        <Text style={[styles.sectionTitle, { marginTop: SPACING.xl, marginBottom: SPACING.sm }]}>
          Smart Suggestions
        </Text>
        <View style={styles.suggestionCard}>
          <View style={styles.suggestionIconBg}>
            <FontAwesome5 name="seedling" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.suggestionTitle}>Grow Maize in Plot B this season</Text>
            <Text style={styles.suggestionSub}>
              34% higher profit expected based on current market trends
            </Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 48 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  greeting: { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  leafEmoji: { fontSize: 20 },
  locationText: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.card,
  },
  bellBadge: {
    position: 'absolute', top: 10, right: 10,
    width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accentRed,
  },

  // Weather Card
  weatherCard: {
    borderRadius: RADII.xl,
    padding: SPACING.xxl, marginBottom: SPACING.xl,
    borderWidth: 1,
    overflow: 'hidden', position: 'relative',
    ...SHADOWS.card,
  },
  weatherTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 10 },
  weatherTemp: { fontSize: 44, fontWeight: '800', color: COLORS.primaryDark, letterSpacing: -1 },
  weatherCond: { fontSize: 14, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  rainBadge: {
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: RADII.lg,
    paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  rainBadgeTitle: { fontSize: 10, color: COLORS.textDark, fontWeight: '700' },
  rainBadgePct: { fontSize: 10, color: COLORS.primary, fontWeight: '600' },
  landscapeGraphic: { marginTop: 20, alignItems: 'flex-end', zIndex: 10 },

  // Overview
  overviewRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.xl },
  overviewCard: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  overviewIconBg: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  overviewTitle: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  overviewSub: { fontSize: 13, fontWeight: '700', color: COLORS.textDark, marginTop: 2 },

  // Section Header
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  viewAllText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Market Prices
  marketRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.sm },
  marketCard: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  marketCrop: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
  marketPrice: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginVertical: 4 },
  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  trendText: { fontSize: 11, fontWeight: '700' },
  miniChartTrack: { height: 3, backgroundColor: '#F3F4F6', borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  miniChartLine: { borderRadius: 2 },

  // Smart Suggestions
  suggestionCard: {
    backgroundColor: '#F4F9F5', borderRadius: RADII.lg,
    padding: SPACING.lg, borderWidth: 1, borderColor: '#C8E6C9',
    flexDirection: 'row', alignItems: 'center', gap: 14,
    ...SHADOWS.card,
  },
  suggestionIconBg: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center',
  },
  suggestionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primaryDark },
  suggestionSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 16 },
});
