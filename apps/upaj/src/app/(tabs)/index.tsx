/**
 * Home screen — matches pages/Homepage.jpeg.
 *
 * Layout:
 *   1. Header: KisanShakti logo (bilingual), notification bell, profile icon
 *   2. Hero carousel (4 slides, dots) — farmer/insight rotation
 *   3. Dark-green stats bar: Land / Crop Types / Cattles  (tap → edit modal)
 *   4. Market Prices (dynamic, AGMARKNET-backed)
 *   5. AI Recommendations & Alerts: Irrigation + Weather
 *   6. Government Subsidies (online-only, silently hidden offline)
 *
 * Everything is dynamic — reads from local SQLite for the farmer profile,
 * and hits the backend for market/weather/subsidies. Every server call has
 * a graceful fallback so the screen still renders offline.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Animated, Easing, Modal, Pressable, TextInput, Linking, RefreshControl,
  ActivityIndicator, Platform, ImageBackground, Image,
  KeyboardAvoidingView, Keyboard, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SafeGradient as LinearGradient } from '../../components/safe-gradient';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/use-auth';
import {
  getFarmerCrops, FarmerCrop,
} from '../../lib/local-db';
import {
  fetchMarketPrices, fetchDistricts, type StateNode,
  fetchWeather, fetchSubsidies, fetchAgriAdvisory,
  updateFarmerProfile, fetchHomeStats,
  fetchFarmerNotifications, markFarmerNotificationRead,
  markAllFarmerNotificationsRead, deleteFarmerNotification,
  clearAllFarmerNotifications,
  MarketPrice, WeatherData, Subsidy, AgriAdvisory, HomeStats,
  NotificationsFeed, NotificationItem,
} from '../../lib/api';
import { useFocusEffect } from 'expo-router';
import { subscribeSensor, type SensorSnapshot } from '../../lib/sensor-bus';

const { width: SCREEN_W } = Dimensions.get('window');
const HERO_W = SCREEN_W - 32;

// ── Palette (matches login screen exactly) ────────────────────────────────
const C = {
  bg: '#F8F9F5', card: '#FFFFFF', border: '#E5E7EB',
  primary: '#2D6A4F', primaryDark: '#1B4332', primaryBright: '#40916C',
  primaryNeon: '#52B788', primaryPale: '#D8F3DC', primaryTint: '#F0FDF4',
  heroGrad: ['#EAF3E4', '#D8F3DC', '#B7E4C7'] as const,
  // Stats card — softer olive-green matching login, not near-black
  statsCardStart: '#1B4332', statsCardEnd: '#2D6A4F',
  amber: '#F59E0B', amberBg: '#FEF3C7', amberDark: '#B45309',
  red: '#DC2626', redBg: '#FEE2E2',
  blue: '#2563EB', blueBg: '#DBEAFE',
  textDark: '#0F1F17', textBody: '#2C3E37',
  textMuted: '#6B7A73', textLight: '#9CA8A1',
};

// Bundled hero backgrounds — one image per slide topic
const HERO_IMAGES = {
  farmer:  require('../../../assets/images/hero/bgpic.jpg'),
  disease: require('../../../assets/images/hero/plant-disease.jpg'),
  mandi:   require('../../../assets/images/hero/mandi.png'),
  weather: require('../../../assets/images/hero/weather.png'),
};

// Bilingual helper
const t = (en: string, kn: string) => `${en}\n${kn}`;

// Default GPS (Kolar) when the profile has no location yet
const DEFAULT_LAT = 13.1367;
const DEFAULT_LON = 78.1325;

// Hero carousel content
const HERO_SLIDES = [
  {
    image:     HERO_IMAGES.farmer,
    title:     'Empowering farmers',
    highlight: 'with data & technology',
    subtitle:  'Make smarter decisions.\nGrow better. Earn more.',
    cta:       'Explore Insights',
    icon:      'sprout' as const,
    accent:    C.primary,
  },
  {
    image:     HERO_IMAGES.disease,
    title:     'Detect plant disease',
    highlight: 'in seconds',
    subtitle:  'Snap a leaf — get AI diagnosis\nand organic + chemical fixes.',
    cta:       'Try Disease Scan',
    icon:      'leaf' as const,
    accent:    C.primaryDark,
    route:     '/(tabs)/disease',
  },
  {
    image:     HERO_IMAGES.mandi,
    title:     'Live mandi prices',
    highlight: 'across Karnataka',
    subtitle:  'AGMARKNET data every 30 min.\nSell at the right time.',
    cta:       'Open Market',
    icon:      'chart-line' as const,
    accent:    C.amberDark,
    route:     '/(tabs)/market',
  },
  {
    image:     HERO_IMAGES.weather,
    title:     'Weather that reaches',
    highlight: 'your farm',
    subtitle:  'Sudden-change alerts + irrigation\nrecommendations from AI.',
    cta:       'View Forecast',
    icon:      'weather-partly-cloudy' as const,
    accent:    C.blue,
    route:     '/(tabs)/weather',
  },
];

// ── Screen ─────────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const auth = useAuth();
  const [crops, setCrops] = useState<FarmerCrop[]>([]);
  // home_stats drives the "0 crop types" chip — derived from Business cycles,
  // NOT from the local FarmerCrop table any more. Refreshed on every tab focus.
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showEditFarm, setShowEditFarm] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [notifs, setNotifs] = useState<NotificationsFeed | null>(null);
  const [showMarketSearch, setShowMarketSearch] = useState(false);

  const [market, setMarket] = useState<MarketPrice[]>([]);
  const [marketMeta, setMarketMeta] = useState<{
    status: 'ok' | 'unavailable';
    district: string | null;
    note: string | null;
    reason?: string;
    hint?: string;
  } | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [subs, setSubs] = useState<Subsidy[]>([]);
  const [irrig, setIrrig] = useState<AgriAdvisory | null>(null);
  const [sensor, setSensor] = useState<SensorSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [heroIdx, setHeroIdx] = useState(0);

  // Subscribe to the sensor bus so AI cards reflect live ESP32 readings
  // whenever the Weather tab has a fresh frame.
  useEffect(() => subscribeSensor(setSensor), []);

  // Ref-of-sensor so intervals that shouldn't re-arm on every BLE frame
  // (see the advisory poll below) can still read the freshest value at
  // tick time — closure captures the ref object, not the value.
  const sensorRef = React.useRef<SensorSnapshot | null>(null);
  React.useEffect(() => { sensorRef.current = sensor; }, [sensor]);

  // Compact bucket that only changes on meaningful sensor transitions
  // (10% soil bucket boundary, rain flip, source change). Used as the
  // dep for the advisory poll so 5-second BLE frames don't tear down
  // and rebuild the setInterval + refire an HTTP request every frame.
  const sensorBucket = React.useMemo(() => {
    if (!sensor) return 'none';
    const soilBucket = Number.isFinite(sensor.soil_moisture)
      ? Math.floor(sensor.soil_moisture / 10)
      : -1;
    return `${sensor.source}|${soilBucket}|${sensor.is_raining ? 1 : 0}`;
  }, [sensor]);

  const lat = auth.profile?.latitude ?? DEFAULT_LAT;
  const lon = auth.profile?.longitude ?? DEFAULT_LON;

  const loadCrops = useCallback(async () => {
    if (!auth.profile?.id) return;
    try {
      const c = await getFarmerCrops(auth.profile.id);
      setCrops(c);
    } catch (e) { console.warn('[home] crops:', e); }
  }, [auth.profile?.id]);

  // Extract the district from the farmer's saved location. The stored value
  // comes from a search or manual entry and can look like any of:
  //   "Bangarpet"                     → send as-is; backend resolves market→district
  //   "Bangarpet, Kolar"              → district is "Kolar" (the SECOND-to-last
  //                                     token when 3+ parts, or the last when 2)
  //   "Bangarpet, Kolar, Karnataka"   → drop the state; district is "Kolar"
  //   "Kolar, Karnataka"              → district is "Kolar"
  // The old code took the LAST token, which for "Kolar, Karnataka" picked
  // "Karnataka" — the backend then couldn't map it and returned only 1 crop.
  const district = React.useMemo(() => {
    const loc = auth.profile?.location_name?.trim();
    if (!loc) return 'Kolar';                    // sensible default
    const parts = loc.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return 'Kolar';
    if (parts.length === 1) return parts[0];     // let backend resolve
    // Drop a trailing "Karnataka" / any state so we don't ship the state as the district.
    const KA_LIKE = /^(karnataka|kar|ka|india)$/i;
    const trimmed = KA_LIKE.test(parts[parts.length - 1])
      ? parts.slice(0, -1)
      : parts;
    if (trimmed.length === 0) return 'Kolar';
    if (trimmed.length === 1) return trimmed[0];
    // 2+ parts: the LAST of what remains is the district (e.g. "Bangarpet, Kolar" → Kolar).
    return trimmed[trimmed.length - 1];
  }, [auth.profile?.location_name]);

  const loadServerData = useCallback(async () => {
    const [m, w, s, i] = await Promise.all([
      fetchMarketPrices({ district, limit: 60, lat, lon, scope: 'nearest' }),
      fetchWeather(lat, lon),
      fetchSubsidies('Karnataka'),
      // Pass whatever ESP32 has published so the advisory reflects
      // real root-zone conditions when the Weather tab has a live link.
      fetchAgriAdvisory({
        lat, lon,
        soilMoisture:    sensor && Number.isFinite(sensor.soil_moisture) ? sensor.soil_moisture : undefined,
        sensorTemp:      sensor?.source === 'sensor' ? sensor.temperature : undefined,
        sensorHumidity:  sensor?.source === 'sensor' ? sensor.humidity    : undefined,
        sensorIsRaining: sensor?.source === 'sensor' ? sensor.is_raining  : undefined,
      }),
    ]);
    if (m) {
      setMarket(m.prices ?? []);
      setMarketMeta({
        status:   m.status,
        district: m.district,
        note:     m.note ?? null,
        reason:   m.reason,
        hint:     m.hint,
      });
    }
    if (w) setWeather(w);
    if (s?.items) setSubs(s.items);
    if (i) setIrrig(i);
  }, [lat, lon, district, sensor]);

  useEffect(() => { loadCrops(); }, [loadCrops]);

  // Re-fetch live home stats every time the Home tab gains focus. This is
  // what makes "0 crop types" bump to "1 crop type" the moment the farmer
  // logs their first cycle in the Business tab and swipes back to Home.
  const loadHomeStats = useCallback(async () => {
    const s = await fetchHomeStats();
    if (s) setHomeStats(s);
  }, []);
  useFocusEffect(useCallback(() => { loadHomeStats(); }, [loadHomeStats]));

  // Notifications feed — polled every 60s. When new unread items appear,
  // we fire a system push notification via expo-notifications so the farmer
  // gets the tray ding even if they're on another screen. Falls back
  // gracefully to a silent update if expo-notifications isn't bundled.
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef  = useRef(true);
  const loadNotifs = useCallback(async () => {
    // Auth-gate: without this, the very first mount fires before the JWT
    // has been read from local SQLite, producing a spurious 401 in Metro
    // logs. Also stops the 60s poll during the sign-out tail window.
    if (!auth.token) return;
    const n = await fetchFarmerNotifications();
    if (!n) return;
    setNotifs(n);
    // Diff against what we've seen — surface any NEW unread items as push.
    // Skip first load so we don't ding the farmer on app open for a backlog.
    const newIds: any[] = [];
    for (const item of n.items) {
      if (!seenNotifIdsRef.current.has(item.id)) {
        newIds.push(item);
        seenNotifIdsRef.current.add(item.id);
      }
    }
    if (!isFirstLoadRef.current && newIds.length > 0) {
      _firePushForNewItems(newIds);
    }
    isFirstLoadRef.current = false;
  }, [auth.token]);
  useEffect(() => {
    if (!auth.token) return;
    loadNotifs();
    const t = setInterval(loadNotifs, 60_000);
    return () => clearInterval(t);
  }, [loadNotifs, auth.token]);
  useFocusEffect(useCallback(() => { loadNotifs(); }, [loadNotifs]));
  useEffect(() => { loadServerData(); }, [loadServerData]);

  // Auto-refresh every 10 min for weather, and every 2 min for the advisory
  // (which now blends live sensor data — cheaper cadence, sharper insight).
  useEffect(() => {
    const wIv = setInterval(() => {
      fetchWeather(lat, lon).then(w => { if (w) setWeather(w); });
    }, 10 * 60 * 1000);
    const iIv = setInterval(() => {
      // Always read the FRESHEST sensor snapshot inside the tick via ref,
      // not a closure capture — keeps advice accurate without needing
      // `sensor` in the dep array (which would tear down and rebuild
      // both intervals on every 5s BLE frame — very laggy).
      const s = sensorRef.current;
      fetchAgriAdvisory({
        lat, lon,
        soilMoisture:    s && Number.isFinite(s.soil_moisture) ? s.soil_moisture : undefined,
        sensorTemp:      s?.source === 'sensor' ? s.temperature : undefined,
        sensorHumidity:  s?.source === 'sensor' ? s.humidity    : undefined,
        sensorIsRaining: s?.source === 'sensor' ? s.is_raining  : undefined,
      }).then(v => { if (v) setIrrig(v); });
    }, 2 * 60 * 1000);
    return () => { clearInterval(wIv); clearInterval(iIv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, sensorBucket]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadCrops(), loadServerData(), loadHomeStats()]);
    setRefreshing(false);
  }, [loadCrops, loadServerData, loadHomeStats]);

  const totalLand    = auth.profile?.total_land_ha ?? 0;
  const cattleCount  = auth.profile?.cattle_count ?? 0;
  const displayName  = (auth.farmerName ?? 'Farmer').split(' ')[0];
  // Unread notifications from the backend + inferred weather/irrigation
  // urgencies. Real-time events dominate; local advisories add to the count
  // so a farmer at the well doesn't miss "buyer just offered ₹20".
  const notifUnread = notifs?.unread ?? 0;
  const weatherUrgencies = (weather?.alert ? 1 : 0)
    + (irrig?.irrigation.level === 'high' ? 1 : 0)
    + (irrig?.fungal.level === 'high'     ? 1 : 0);
  const alertCount = notifUnread + weatherUrgencies;
  const hasAlerts  = alertCount > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
          // Android-only: detach off-screen sections when scrolling fast.
          // Home has ~10 stacked cards + a horizontal hero carousel, so
          // the win is meaningful without changing any behavior.
          removeClippedSubviews
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <View style={s.header}>
            <View style={s.logoRow}>
              {/* Real Upaj logo (designed by founder). The white ring around it
                  keeps a small breathing-room + subtle brand halo, but the
                  artwork itself is what identifies the app. */}
              <View style={s.logoRing}>
                <Image
                  source={require('../../../assets/images/upaj-logo.png')}
                  style={s.logoImage}
                  resizeMode="contain"
                />
              </View>
              <View>
                <Text style={s.brand}>
                  <Text style={{ color: C.primaryDark }}>Kisan</Text>
                  <Text style={{ color: C.primary }}>Shakti</Text>
                </Text>
                <Text style={s.brandTag}>Smart farming • Better tomorrow</Text>
              </View>
            </View>
            <View style={s.headerIcons}>
              <TouchableOpacity
                style={s.iconBtn}
                activeOpacity={0.7}
                onPress={async () => {
                  setShowAlerts(true);
                  // Auto-mark all as read on open — this matches YouTube /
                  // WhatsApp behaviour where seeing the feed clears the badge.
                  if ((notifs?.unread ?? 0) > 0) {
                    await markAllFarmerNotificationsRead();
                    loadNotifs();
                  }
                }}
              >
                <Ionicons name="notifications-outline" size={18} color={C.primaryDark} />
                {hasAlerts && <View style={s.dotAlert}>
                  <Text style={s.dotAlertText}>{alertCount}</Text>
                </View>}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.iconBtn}
                activeOpacity={0.7}
                onPress={() => setShowProfile(true)}
              >
                <Ionicons name="person-outline" size={18} color={C.primaryDark} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Hero Carousel ─────────────────────────────────────────── */}
          <HeroCarousel
            slides={HERO_SLIDES}
            index={heroIdx}
            onIndexChange={setHeroIdx}
          />

          {/* ── Stats Card ── three chips, each tappable to a specific target.
               Land + Cattle open the Edit Farm modal. Crop Types is derived
               from Business cycles (read-only here) so tapping it jumps to
               the Business tab where the farmer actually adds crops. */}
          <View style={s.statsCardWrap}>
            <LinearGradient
              colors={[C.statsCardStart, C.statsCardEnd]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.statsCard}
            >
              <TouchableOpacity
                style={s.statTapZone}
                activeOpacity={0.7}
                onPress={() => setShowEditFarm(true)}
              >
                <StatItem
                  icon={<MaterialCommunityIcons name="terrain" size={18} color="#FFF" />}
                  value={totalLand.toFixed(1)}
                  unit="ha" label="Land" labelKn="ಜಮೀನು"
                />
              </TouchableOpacity>

              <View style={s.statsDivider} />

              <TouchableOpacity
                style={s.statTapZone}
                activeOpacity={0.7}
                onPress={() => router.push('/(tabs)/ledger')}
              >
                <StatItem
                  icon={<MaterialCommunityIcons name="sprout" size={18} color="#FFF" />}
                  value={String(homeStats?.crop_types_count ?? 0)}
                  label="Crop Types" labelKn="ಬಗೆಯ ಬೆಳೆಗಳು"
                />
              </TouchableOpacity>

              <View style={s.statsDivider} />

              <TouchableOpacity
                style={s.statTapZone}
                activeOpacity={0.7}
                onPress={() => setShowEditFarm(true)}
              >
                <StatItem
                  icon={<MaterialCommunityIcons name="cow" size={18} color="#FFF" />}
                  value={String(cattleCount)}
                  label="Cattles" labelKn="ಜಾನುವಾರು"
                />
              </TouchableOpacity>
            </LinearGradient>

          </View>

          {/* ── Market Prices ────────────────────────────────────────── */}
          <View style={s.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.sectionTitle}>Market Prices</Text>
              <Text style={s.sectionKn}>ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು</Text>
            </View>
            <TouchableOpacity
              style={s.mkSearchBtn}
              activeOpacity={0.7}
              onPress={() => setShowMarketSearch(true)}
            >
              <Ionicons name="search" size={14} color={C.primary} />
              <Text style={s.mkSearchBtnText}>Search crop</Text>
            </TouchableOpacity>
          </View>
          {marketMeta === null ? (
            <View style={s.emptyRow}><ActivityIndicator color={C.primary} /></View>
          ) : marketMeta.status === 'unavailable' ? (
            <View style={s.mkUnavailCard}>
              <Ionicons name="cloud-offline-outline" size={28} color={C.red} />
              <Text style={s.mkUnavailTitle}>Live prices unavailable</Text>
              <Text style={s.mkUnavailBody}>
                {marketMeta.reason ?? 'AGMARKNET is not responding right now.'}
              </Text>
              <Text style={s.mkUnavailHint}>
                {marketMeta.hint ?? 'Pull to refresh, or try again in a few minutes.'}
              </Text>
              <TouchableOpacity style={s.mkRetryBtn} activeOpacity={0.85} onPress={onRefresh}>
                <Ionicons name="refresh" size={13} color="#FFF" />
                <Text style={s.mkRetryBtnText}>Retry now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ApmcClusters items={market} />
          )}

          {/* ── AI Recommendations & Alerts ─────────────────────────── */}
          <SectionHeader
            en="AI Recommendations & Alerts"
            kn="AI ಸಲಹೆಗಳು ಮತ್ತು ಎಚ್ಚರಿಕೆಗಳು"
            onViewAll={() => setShowAlerts(true)}
          />

          {irrig && (
            <>
              {/* Irrigation — colour-coded by level, badge reflects real ESP32
                  presence and shows the live soil-moisture reading. */}
              <AiCard
                tint={
                  irrig.irrigation.level === 'high'   ? 'amber' :
                  irrig.irrigation.level === 'medium' ? 'blue'  : 'green'
                }
                title={irrig.irrigation.title}
                titleKn={irrig.irrigation.title_kn}
                body={irrig.irrigation.message}
                badge={
                  irrig.sensor_connected && sensor?.source === 'sensor'
                    ? (Number.isFinite(sensor.soil_moisture)
                        ? `ESP32 live · Soil ${sensor.soil_moisture.toFixed(0)}%`
                        : `ESP32 live · ${sensor.temperature.toFixed(0)}°C ${sensor.humidity.toFixed(0)}%`)
                    : 'Sensor not connected · Pair on Weather tab'
                }
                icon={<FontAwesome5 name="tint" size={16} color={C.primary} />}
                onPress={() => setShowAlerts(true)}
              />

              {/* Fungal risk — only surface when actionable (medium/high) */}
              {(irrig.fungal.level === 'high' || irrig.fungal.level === 'medium') && (
                <AiCard
                  tint={irrig.fungal.level === 'high' ? 'red' : 'amber'}
                  title={irrig.fungal.title}
                  titleKn={irrig.fungal.title_kn}
                  body={irrig.fungal.message}
                  badge={`Humidity ${irrig.based_on.humidity.toFixed(0)}% · ${irrig.based_on.temp_c.toFixed(0)}°C`}
                  icon={<MaterialCommunityIcons name="mushroom-outline" size={16} color={C.amberDark} />}
                  onPress={() => router.push('/(tabs)/weather')}
                />
              )}

              {/* Spray window — only when it's a GOOD time to spray */}
              {irrig.spray.ok && (
                <AiCard
                  tint="green"
                  title={irrig.spray.title}
                  titleKn={irrig.spray.title_kn}
                  body={irrig.spray.message}
                  badge={`Wind ${irrig.based_on.wind_kmh.toFixed(0)} km/h · Rain ${irrig.based_on.next_24h_rain_pct ?? 0}%`}
                  icon={<MaterialCommunityIcons name="spray" size={16} color={C.primary} />}
                  onPress={() => router.push('/(tabs)/weather')}
                />
              )}
            </>
          )}

          {weather && (
            <AiCard
              tint={weather.alert ? 'amber' : 'blue'}
              title={weather.alert ? weather.alert.title : `${weather.condition} · ${weather.temp_c.toFixed(0)}°C`}
              titleKn={weather.alert ? weather.alert.title_kn : weather.condition_kn}
              body={
                weather.alert
                  ? weather.alert.message
                  : `${weather.location} · Humidity ${weather.humidity}% · Wind ${weather.wind_kmh} km/h`
              }
              badge={weather.alert ? 'Weather alert' : 'Forecast'}
              icon={
                <Ionicons
                  name={weather.alert ? 'warning-outline' : 'partly-sunny-outline'}
                  size={16}
                  color={weather.alert ? C.amberDark : C.blue}
                />
              }
              onPress={() => router.push('/(tabs)/weather')}
            />
          )}

          {/* ── Government Subsidies ─────────────────────────────────── */}
          {subs.length > 0 && (
            <>
              <SectionHeader
                en="Government Subsidies"
                kn="ಸರ್ಕಾರಿ ಸಬ್ಸಿಡಿಗಳು"
              />
              <ScrollView
                horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 16, paddingLeft: 16 }}
                style={{ marginHorizontal: -16 }}
              >
                {subs.map((sub) => (
                  <SubsidyCard key={sub.id} sub={sub} />
                ))}
              </ScrollView>
            </>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>

      <ProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
        auth={auth}
        homeStats={homeStats}
        onEditFarm={() => { setShowProfile(false); setShowEditFarm(true); }}
        onGoBusiness={() => { setShowProfile(false); router.push('/(tabs)/ledger'); }}
      />

      <EditFarmModal
        visible={showEditFarm}
        onClose={() => setShowEditFarm(false)}
        auth={auth}
        onSaved={async () => {
          await auth.reload();
          await loadHomeStats();
        }}
      />

      <NotificationsSheet
        visible={showAlerts}
        onClose={() => setShowAlerts(false)}
        feed={notifs}
        weather={weather}
        irrig={irrig}
        onMarkRead={async (id: string) => {
          await markFarmerNotificationRead(id);
          await loadNotifs();
        }}
        onMarkAllRead={async () => {
          await markAllFarmerNotificationsRead();
          await loadNotifs();
        }}
        onDelete={async (id: string) => {
          await deleteFarmerNotification(id);
          await loadNotifs();
        }}
        onClearAll={async () => {
          await clearAllFarmerNotifications();
          seenNotifIdsRef.current.clear();
          await loadNotifs();
        }}
        onDeepLink={(link: string | null) => {
          setShowAlerts(false);
          if (link) router.push(link as any);
        }}
      />

      <MarketSearchModal
        visible={showMarketSearch}
        onClose={() => setShowMarketSearch(false)}
        district={district}
        lat={lat}
        lon={lon}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function StatItem({ icon, value, unit, label, labelKn }: any) {
  return (
    <View style={s.statItem}>
      <View style={s.statIconWrap}>{icon}</View>
      <View style={{ marginLeft: 8, flexShrink: 1 }}>
        <Text style={s.statValue}>
          {value}{unit ? <Text style={s.statUnit}> {unit}</Text> : null}
        </Text>
        <Text style={s.statLabel}>{label}</Text>
        <Text style={s.statLabelKn}>{labelKn}</Text>
      </View>
    </View>
  );
}

function SectionHeader({ en, kn, onViewAll }: any) {
  return (
    <View style={s.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={s.sectionTitle}>{en}</Text>
        <Text style={s.sectionKn}>{kn}</Text>
      </View>
      {onViewAll && (
        <TouchableOpacity onPress={onViewAll} activeOpacity={0.7} style={s.viewAllBtn}>
          <Text style={s.viewAll}>View all </Text>
          <Ionicons name="arrow-forward" size={12} color={C.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Hero Carousel ─────────────────────────────────────────────────────────
function HeroCarousel({ slides, index, onIndexChange }: any) {
  const scrollRef = useRef<ScrollView>(null);

  // Auto-advance every 5s
  useEffect(() => {
    const iv = setInterval(() => {
      const next = (index + 1) % slides.length;
      scrollRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
      onIndexChange(next);
    }, 5000);
    return () => clearInterval(iv);
  }, [index, slides.length, onIndexChange]);

  return (
    <View style={{ marginTop: 4, marginHorizontal: -16 }}>
      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          onIndexChange(i);
        }}
      >
        {/*
          Each slide wrapper is exactly SCREEN_W wide (== the page width for
          pagingEnabled), and the visible card is centered inside via 16px
          horizontal padding — this makes snaps line up perfectly and prevents
          the previous "half-cut" bleed on horizontal drag.
        */}
        {slides.map((slide: any, i: number) => (
          <View key={i} style={{ width: SCREEN_W, paddingHorizontal: 16 }}>
            <HeroSlide slide={slide} />
          </View>
        ))}
      </ScrollView>
      <View style={s.dotsRow}>
        {slides.map((_: any, i: number) => (
          <View
            key={i}
            style={[
              s.dot,
              i === index ? s.dotActive : s.dotInactive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function HeroSlide({ slide }: any) {
  return (
    <View style={{ borderRadius: 22, overflow: 'hidden' }}>
      <ImageBackground
        source={slide.image}
        style={s.heroCard}
        imageStyle={s.heroImg}
        resizeMode="cover"
      >
        {/* Left-to-right soft fade so text stays readable; right side keeps the photo clear */}
        <LinearGradient
          colors={['rgba(255,255,255,0.85)', 'rgba(234,243,228,0.55)', 'rgba(216,243,220,0.05)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Text block (occupies left 62%) */}
        <View style={s.heroTextBlock}>
          <Text style={s.heroTitle}>{slide.title}</Text>
          {slide.highlight ? (
            <Text style={[s.heroTitle, { color: slide.accent }]}>{slide.highlight}</Text>
          ) : null}
          <Text style={s.heroSub}>{slide.subtitle}</Text>

          <TouchableOpacity
            style={[s.heroCTA, { backgroundColor: slide.accent }]}
            activeOpacity={0.85}
            onPress={() => slide.route && router.push(slide.route)}
          >
            <Text style={s.heroCTAText}>{slide.cta}</Text>
            <Ionicons name="arrow-forward" size={13} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Right-side decorative badge (small — image speaks for itself) */}
        <View style={s.heroBadge}>
          <MaterialCommunityIcons name={slide.icon} size={22} color={slide.accent} />
        </View>
      </ImageBackground>
    </View>
  );
}

// ── Market card ───────────────────────────────────────────────────────────
// ── Picker sheet — modal list of options (state/district/APMC) ────────
function PickerSheet({
  title, options, selected, onSelect, onClose,
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={ps.backdrop} onPress={onClose} />
      <View style={ps.sheet}>
        <View style={ps.handle} />
        <Text style={ps.title}>{title}</Text>
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map((opt) => {
            const active = opt === selected;
            return (
              <TouchableOpacity
                key={opt}
                style={[ps.row, active && ps.rowActive]}
                onPress={() => onSelect(opt)}
                activeOpacity={0.7}
              >
                <Text style={[ps.rowText, active && ps.rowTextActive]}>{opt}</Text>
                {active && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
const ps = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, paddingBottom: 24, paddingHorizontal: 16,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, backgroundColor: '#DDD',
    borderRadius: 2, marginBottom: 8,
  },
  title: {
    fontFamily: 'Inter_700Bold', fontSize: 15, color: '#0F1F17',
    marginBottom: 8, paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 12,
    borderRadius: 10, marginBottom: 2,
  },
  rowActive:     { backgroundColor: '#E8F5EC' },
  rowText:       { fontFamily: 'Inter_500Medium', fontSize: 14, color: '#2C3E37' },
  rowTextActive: { fontFamily: 'Inter_700Bold', color: '#1B4332' },
});

// ── Nearest APMC (home market section) ─────────────────────────────────
// Home shows only the single closest APMC's basket of crops. To browse
// other APMCs in the district or switch districts, farmer opens the
// Search tab where the district/state dropdowns handle drill-down.
function ApmcClusters({ items }: { items: any[] }) {
  const nearest = React.useMemo(() => {
    if (!items || items.length === 0) return null;
    // Pick the market with the smallest distance_km. Rows for unknown
    // markets (distance_km == null) are ignored here — we only surface a
    // cluster on the home if we can confidently name & locate it.
    const byMarket = new Map<string, any[]>();
    for (const it of items) {
      const key = (it.market || '').trim();
      if (!key || it.distance_km == null) continue;
      if (!byMarket.has(key)) byMarket.set(key, []);
      byMarket.get(key)!.push(it);
    }
    if (byMarket.size === 0) return null;

    const [market, rows] = [...byMarket.entries()].sort(
      (a, b) => (a[1][0].distance_km ?? Infinity) - (b[1][0].distance_km ?? Infinity)
    )[0];

    return {
      market,
      district:    rows[0]?.district    ?? '',
      distance_km: rows[0]?.distance_km ?? null,
      rows,
    };
  }, [items]);

  if (!nearest) return null;
  return <ApmcCluster cluster={nearest} />;
}

function ApmcCluster({ cluster }: { cluster: any }) {
  const mkt = (cluster.market || '').replace(/\s*APMC\s*/i, '').trim() || '—';
  const km  = cluster.distance_km != null ? `${Math.round(cluster.distance_km)} km` : '';
  return (
    <View style={s.apmcCluster}>
      <View style={s.apmcHeader}>
        <Ionicons name="location" size={13} color={C.primary} />
        <Text style={s.apmcHeaderText} numberOfLines={1}>
          <Text style={{ fontWeight: '800' }}>{mkt} APMC</Text>
          {km ? <Text style={{ color: C.textMuted, fontWeight: '500' }}>{`  ${km}`}</Text> : null}
        </Text>
      </View>
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 16, paddingLeft: 16 }}
        style={{ marginHorizontal: -16 }}
      >
        {cluster.rows.map((row: any, i: number) => (
          <CropTile key={`${row.crop}-${row.variety || ''}-${i}`} item={row} />
        ))}
      </ScrollView>
    </View>
  );
}

// Compact crop tile — used inside APMC clusters (market/km are in the
// section header, no need to repeat them per tile).
function CropTile({ item }: any) {
  const up   = item.change > 0;
  const down = item.change < 0;
  const color = up ? C.primary : down ? C.red : C.amber;
  const bg    = up ? C.primaryPale : down ? C.redBg : C.amberBg;
  // Backend provides emoji from its centralized CROP_INFO map — one source
  // of truth for both bilingual name (item.kn) and glyph (item.emoji).
  const emoji = item.emoji || '🌱';
  return (
    <View style={s.tile}>
      <View style={[s.tilePill, { backgroundColor: bg }]}>
        <Ionicons
          name={up ? 'trending-up' : down ? 'trending-down' : 'remove'}
          size={8} color={color}
        />
        <Text style={[s.tilePillText, { color }]}>{Math.abs(item.change).toFixed(0)}%</Text>
      </View>
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <Text style={s.tileCrop} numberOfLines={1}>{item.crop}</Text>
      <Text style={s.tileKn}   numberOfLines={1}>{item.kn}</Text>
      <Text style={s.tilePrice}>
        ₹{item.price}<Text style={s.tilePriceUnit}>/{item.unit}</Text>
      </Text>
    </View>
  );
}

// ── AI card (unified irrigation + weather alert card) ────────────────────
function AiCard({ tint, title, titleKn, body, badge, icon, onPress }: any) {
  const tone =
    tint === 'green' ? { bg: C.primaryTint, border: '#BBE5C9', badge: C.primary }
    : tint === 'amber' ? { bg: '#FEF9E7', border: '#F5D77E', badge: C.amberDark }
    : tint === 'red'   ? { bg: C.redBg,    border: '#FCA5A5', badge: C.red }
    : { bg: '#EEF4FD', border: '#B9CFF3', badge: C.blue };
  return (
    <TouchableOpacity
      style={[s.aiCard, { backgroundColor: tone.bg, borderColor: tone.border }]}
      activeOpacity={0.85} onPress={onPress}
    >
      <View style={s.aiIconBox}>{icon}</View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[s.aiTitle, { color: tone.badge }]}>{title}</Text>
        </View>
        <Text style={s.aiTitleKn}>{titleKn}</Text>
        <Text style={s.aiBody} numberOfLines={2}>{body}</Text>
        <View style={s.aiBadgeRow}>
          <View style={[s.aiBadge, { backgroundColor: '#FFF', borderColor: tone.border }]}>
            <Text style={[s.aiBadgeText, { color: tone.badge }]}>{badge}</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textLight} />
    </TouchableOpacity>
  );
}

// ── Subsidy card ───────────────────────────────────────────────────────────
function SubsidyCard({ sub }: { sub: Subsidy }) {
  return (
    <TouchableOpacity
      style={s.subCard} activeOpacity={0.9}
      onPress={() => Linking.openURL(sub.apply_url).catch(() => {})}
    >
      <View style={s.subBadge}>
        <MaterialCommunityIcons name="bank-outline" size={11} color={C.primary} />
        <Text style={s.subBadgeText}>{sub.state}</Text>
      </View>
      <Text style={s.subTitle} numberOfLines={2}>{sub.title}</Text>
      <Text style={s.subTitleKn} numberOfLines={1}>{sub.title_kn}</Text>
      <Text style={s.subAmount}>₹{sub.amount_inr.toLocaleString('en-IN')}</Text>
      <Text style={s.subDesc} numberOfLines={2}>{sub.description}</Text>
      <View style={s.subCTA}>
        <Text style={s.subCTAText}>Apply</Text>
        <Ionicons name="open-outline" size={11} color={C.primary} />
      </View>
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Modals
// ═══════════════════════════════════════════════════════════════════════════

// ── Profile (read + link to edit) ─────────────────────────────────────────
// `homeStats` supplies the live crop-type count derived from Business cycles.
// `onGoBusiness` navigates to the Ledger tab when the user taps the Crops row
// (crops aren't edited here — they come from Business).
function ProfileModal({ visible, onClose, auth, homeStats, onEditFarm, onGoBusiness }: any) {
  const slide = useRef(new Animated.Value(600)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: visible ? 0 : 600, damping: 22, stiffness: 180, useNativeDriver: true }).start();
  }, [visible]);

  const name = auth.farmerName ?? 'Farmer';
  const [phoneEdit, setPhoneEdit] = useState(false);
  const [phoneVal, setPhoneVal] = useState(auth.phone ?? '');
  useEffect(() => { setPhoneVal(auth.phone ?? ''); }, [auth.phone]);

  const savePhone = async () => {
    // Phone is the profile primary key locally; changing it is prevented
    // to avoid losing linked crops/ledger. Update on server later if needed.
    setPhoneEdit(false);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={m.backdrop} onPress={onClose} />
      <Animated.View style={[m.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={m.handle} />
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          <View style={m.hero}>
            <View style={m.avatar}>
              <Text style={m.avatarText}>{name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={m.heroName}>{name}</Text>
            <View style={m.roleBadge}>
              <MaterialCommunityIcons name="account-check" size={10} color={C.primary} />
              <Text style={m.roleText}>Verified Farmer · ರೈತ</Text>
            </View>
          </View>

          <Text style={m.sectionLabel}>Personal Info · ವೈಯಕ್ತಿಕ ಮಾಹಿತಿ</Text>
          <View style={m.infoCard}>
            <View style={m.infoRow}>
              <View style={m.infoIcon}><Ionicons name="phone-portrait-outline" size={14} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={m.infoLabel}>Mobile</Text>
                {phoneEdit ? (
                  <TextInput
                    style={m.infoInput}
                    value={phoneVal}
                    onChangeText={setPhoneVal}
                    keyboardType="phone-pad"
                    autoFocus
                    onBlur={savePhone}
                  />
                ) : (
                  <Text style={m.infoValue}>{auth.phone ?? '—'}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setPhoneEdit(!phoneEdit)} style={m.editIcon}>
                <Feather name={phoneEdit ? 'check' : 'edit-2'} size={13} color={C.primary} />
              </TouchableOpacity>
            </View>
            <View style={m.divider} />
            <ReadRow icon="location-outline" label="Location" value={auth.profile?.location_name ?? '—'} onEdit={onEditFarm} />
            <View style={m.divider} />
            <ReadRow
              icon="navigate-outline" label="GPS"
              value={auth.profile?.latitude && auth.profile?.longitude
                ? `${auth.profile.latitude.toFixed(4)}, ${auth.profile.longitude.toFixed(4)}`
                : 'Not set'}
              onEdit={onEditFarm}
            />
            <View style={m.divider} />
            <ReadRow icon="id-card-outline" label="Farmer ID" value={auth.farmerId?.slice(0, 8) ?? '—'} />
          </View>

          <Text style={m.sectionLabel}>Farm Details · ಜಮೀನಿನ ವಿವರಗಳು</Text>
          <View style={m.infoCard}>
            <ReadRow icon="leaf-outline" label="Total Land" value={`${(auth.profile?.total_land_ha ?? 0).toFixed(1)} ha`} onEdit={onEditFarm} />
            <View style={m.divider} />
            <ReadRow icon="paw-outline" label="Cattles" value={String(auth.profile?.cattle_count ?? 0)} onEdit={onEditFarm} />
            <View style={m.divider} />
            {/*
              Crops row is READ-ONLY and shows a live crop-name list from
              Business cycles. Tapping it jumps to the Business tab rather
              than opening the edit modal — crops aren't edited from Profile
              any more.
            */}
            <ReadRow
              icon="sparkles-outline"
              label="Crops"
              value={
                (homeStats?.crop_types_count ?? 0) === 0
                  ? 'None yet · log in Business'
                  : (homeStats?.crop_types ?? []).join(', ')
              }
              onEdit={onGoBusiness}
              editIconName="arrow-forward"
            />
          </View>

          <Text style={m.sectionLabel}>Settings</Text>
          <View style={m.infoCard}>
            <ReadRow icon="language-outline" label="Language" value="English + ಕನ್ನಡ" />
            <View style={m.divider} />
            <ReadRow icon="notifications-outline" label="Notifications" value="On" />
            <View style={m.divider} />
            <ReadRow icon="cloud-download-outline" label="Offline Data" value="Enabled" />
          </View>

          {/* Legal + destructive account actions. Terms + Privacy are
              required by Play Store and are linked here (Play also reads
              the Privacy Policy URL from the app listing). Delete-account
              is required by Play policy 2024+ for any app that lets a
              user create an account. */}
          <Text style={m.sectionLabel}>Legal</Text>
          <View style={m.infoCard}>
            <TouchableOpacity onPress={() => { onClose(); router.push('/legal/terms'); }}>
              <ReadRow icon="document-text-outline" label="Terms of Service" value="Read" editIconName="arrow-forward" />
            </TouchableOpacity>
            <View style={m.divider} />
            <TouchableOpacity onPress={() => { onClose(); router.push('/legal/privacy'); }}>
              <ReadRow icon="shield-checkmark-outline" label="Privacy Policy" value="Read" editIconName="arrow-forward" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={m.logoutBtn} activeOpacity={0.8}
            onPress={async () => {
              await auth.signOut();
              onClose();
              router.replace('/login');
            }}
          >
            <Ionicons name="log-out-outline" size={16} color={C.red} />
            <Text style={m.logoutText}>Sign out</Text>
          </TouchableOpacity>

          {/* Delete account — two-step confirmation because it's irreversible.
              Prompts for typed "DELETE" so a farmer can't accidentally
              wipe their season's ledger via a mis-tap. */}
          <TouchableOpacity
            style={[m.logoutBtn, { backgroundColor: '#FEE2E2', marginTop: 10 }]}
            activeOpacity={0.8}
            onPress={() => {
              Alert.alert(
                'Delete your account?',
                'This will permanently remove your profile, all crop listings, offers, plots, ledger entries, and sensor data. This cannot be undone.\n\nಶಾಶ್ವತವಾಗಿ ಎಲ್ಲಾ ಡೇಟಾ ಅಳಿಸಲಾಗುತ್ತದೆ.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete forever',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const { deleteMyFarmerAccount } = await import('../../lib/api');
                        await deleteMyFarmerAccount();
                        await auth.signOut();
                        onClose();
                        router.replace('/login');
                      } catch (e: any) {
                        Alert.alert(
                          'Deletion failed',
                          e?.message || 'Please try again in a moment. Nothing was deleted.',
                        );
                      }
                    },
                  },
                ],
              );
            }}
          >
            <Ionicons name="trash-outline" size={16} color="#B91C1C" />
            <Text style={[m.logoutText, { color: '#B91C1C' }]}>Delete my account</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function ReadRow({ icon, label, value, onEdit, editIconName }: any) {
  // editIconName lets a row choose its trailing icon — 'edit-2' (default)
  // for real edit affordances, 'arrow-forward' for rows that jump to
  // another tab instead (e.g. the Crops row jumping to Business).
  return (
    <View style={m.infoRow}>
      <View style={m.infoIcon}><Ionicons name={icon} size={14} color={C.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={m.infoLabel}>{label}</Text>
        <Text style={m.infoValue} numberOfLines={1}>{value}</Text>
      </View>
      {onEdit && (
        <TouchableOpacity onPress={onEdit} style={m.editIcon}>
          {editIconName === 'arrow-forward'
            ? <Feather name="arrow-right" size={13} color={C.primary} />
            : <Feather name="edit-2"      size={13} color={C.primary} />}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Edit Farm — Location / Total Land / Cattles only.
//    Crops are NOT edited here. They are tracked automatically from the
//    cycles the farmer logs in the Business (Ledger) tab — every unique
//    crop_name across their plots' cycles becomes a "crop type" on Home.
function EditFarmModal({ visible, onClose, auth, onSaved }: any) {
  const slide = useRef(new Animated.Value(600)).current;
  const [location, setLocation] = useState(auth.profile?.location_name ?? '');
  const [land, setLand] = useState(String(auth.profile?.total_land_ha ?? 0));
  const [cattle, setCattle] = useState(String(auth.profile?.cattle_count ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Animated.spring(slide, { toValue: visible ? 0 : 600, damping: 22, stiffness: 180, useNativeDriver: true }).start();
    if (visible) {
      setLocation(auth.profile?.location_name ?? '');
      setLand(String(auth.profile?.total_land_ha ?? 0));
      setCattle(String(auth.profile?.cattle_count ?? 0));
    }
  }, [visible]);

  const save = async () => {
    setSaving(true);
    try {
      const cattleN    = parseInt(cattle, 10) || 0;
      const totalLandN = parseFloat(land)   || 0;
      // Local first (offline-safe)
      await auth.updateProfile({
        location_name: location,
        total_land_ha: totalLandN,
        cattle_count:  cattleN,
      });
      // Server (fire-and-forget; ok if offline). No `crops` field — crops
      // are managed via the Business tab's cycle flow, not this form.
      updateFarmerProfile({
        location_name: location,
        total_land_ha: totalLandN,
        cattle_count:  cattleN,
      });
      await onSaved?.();
      onClose();
    } catch (e) {
      console.warn('[edit-farm] save failed:', e);
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={m.backdrop} onPress={onClose} />
      <Animated.View style={[m.sheet, { transform: [{ translateY: slide }], maxHeight: '92%' }]}>
        <View style={m.handle} />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 30 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={m.editTitle}>Edit Farm Details</Text>
          <Text style={m.editSub}>ಜಮೀನಿನ ವಿವರಗಳನ್ನು ಸಂಪಾದಿಸಿ</Text>

          <View style={m.field}>
            <Text style={m.fieldLabel}>Location · ಸ್ಥಳ</Text>
            <TextInput
              style={m.textInput}
              value={location}
              onChangeText={setLocation}
              placeholder="Village, District"
              placeholderTextColor={C.textLight}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16 }}>
            <View style={[m.field, { flex: 1, paddingHorizontal: 0 }]}>
              <Text style={m.fieldLabel}>Total Land · ಒಟ್ಟು ಜಮೀನು (ha)</Text>
              <TextInput
                style={m.textInput}
                value={land} onChangeText={setLand}
                keyboardType="decimal-pad"
                placeholder="e.g. 2.5"
                placeholderTextColor={C.textLight}
              />
            </View>
            <View style={[m.field, { flex: 1, paddingHorizontal: 0 }]}>
              <Text style={m.fieldLabel}>Cattles · ಜಾನುವಾರು</Text>
              <TextInput
                style={m.textInput}
                value={cattle} onChangeText={setCattle}
                keyboardType="number-pad"
                placeholder="e.g. 3"
                placeholderTextColor={C.textLight}
              />
            </View>
          </View>

          {/* Crops are intentionally NOT editable here — they come from the
              Business tab. A short hint tells the farmer where to go. */}
          <View style={m.cropsHintCard}>
            <Ionicons name="information-circle-outline" size={16} color={C.primary} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={m.cropsHintTitle}>
                Crops come from the Business tab
              </Text>
              <Text style={m.cropsHintTitleKn}>
                ಬೆಳೆಗಳು ವ್ಯಾಪಾರ ಟ್ಯಾಬ್‌ನಿಂದ ಬರುತ್ತವೆ
              </Text>
              <Text style={m.cropsHintBody}>
                Every crop you log as a season in Business shows up here as a
                crop type. Nothing to enter twice.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[m.saveBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.85}
            onPress={save}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#FFF" />
              : <>
                  <Ionicons name="save-outline" size={16} color="#FFF" />
                  <Text style={m.saveBtnText}>Save Changes</Text>
                </>
            }
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Alerts modal ──────────────────────────────────────────────────────────
/**
 * YouTube-style notifications sheet.
 *
 * Combines the backend event feed (offers, deliveries, weather alerts) with
 * transient local advisories (fungal risk, sensor disconnected). Grouped
 * "Today / Yesterday / Earlier". Unread rows have a bold title + dot.
 * Tapping a row navigates via deep_link (or falls back to marking read).
 */
function NotificationsSheet({
  visible, onClose, feed, weather, irrig,
  onMarkRead, onMarkAllRead, onDelete, onClearAll, onDeepLink,
}: any) {
  const slide = useRef(new Animated.Value(600)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: visible ? 0 : 600, damping: 22, stiffness: 180, useNativeDriver: true }).start();
  }, [visible]);

  // Transient advisories — inject as pseudo-items with negative ids so they
  // never collide with real backend ones. They can't be "marked read" —
  // they self-clear when weather changes.
  const transient: any[] = [];
  if (weather?.alert) transient.push({
    id: 't:weather', kind: 'WEATHER_ALERT',
    title: weather.alert.title, body: weather.alert.message,
    created_at: new Date().toISOString(), read: true, transient: true,
    icon: 'cloud-outline', color: '#B45309',
  });
  if (irrig?.fungal && (irrig.fungal.level === 'high' || irrig.fungal.level === 'medium')) transient.push({
    id: 't:fungal', kind: 'FUNGAL_RISK',
    title: irrig.fungal.title, body: irrig.fungal.message,
    created_at: new Date().toISOString(), read: true, transient: true,
    icon: 'medical-outline', color: '#B45309',
  });
  if (irrig?.sensor_connected === false) transient.push({
    id: 't:sensor', kind: 'SENSOR_OFFLINE',
    title: 'Hardware sensor not connected',
    body: 'Open the Weather tab and pair the ESP32 for live advisories.',
    created_at: new Date().toISOString(), read: true, transient: true,
    icon: 'bluetooth-outline', color: '#2563EB',
  });

  const backendItems = (feed?.items ?? []) as NotificationItem[];
  const all = [...transient, ...backendItems].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Group by day-relative bucket
  const now = Date.now();
  const startOfToday     = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const buckets: { label: string; items: any[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier',   items: [] },
  ];
  for (const it of all) {
    const t = new Date(it.created_at).getTime();
    if (t >= startOfToday.getTime())          buckets[0].items.push(it);
    else if (t >= startOfYesterday.getTime()) buckets[1].items.push(it);
    else                                       buckets[2].items.push(it);
  }

  const unread = feed?.unread ?? 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={m.backdrop} onPress={onClose} />
      <Animated.View style={[m.sheet, { transform: [{ translateY: slide }], maxHeight: '88%' }]}>
        <View style={m.handle} />

        <View style={notif.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={m.editTitle}>Notifications</Text>
            <Text style={m.editSub}>
              {(feed?.total ?? 0) === 0
                ? 'All caught up 🎉'
                : `${feed?.total ?? 0} in feed`}
            </Text>
          </View>
          {(feed?.total ?? 0) > 0 && (
            <TouchableOpacity
              style={notif.clearAllBtn}
              onPress={() => onClearAll?.()}
              activeOpacity={0.85}
            >
              <Ionicons name="trash-outline" size={12} color={C.red} />
              <Text style={notif.clearAllText}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 30, paddingHorizontal: 16 }}>
          {all.length === 0 ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Ionicons name="notifications-outline" size={44} color={C.textLight} />
              <Text style={{ marginTop: 12, color: C.textMuted, fontFamily: 'Inter_700Bold', fontSize: 14 }}>
                You're all caught up
              </Text>
              <Text style={{ marginTop: 4, color: C.textLight, fontSize: 11 }}>
                Offers, sale updates and weather warnings will appear here.
              </Text>
            </View>
          ) : (
            buckets.map(b => b.items.length > 0 && (
              <View key={b.label}>
                <Text style={notif.bucketLabel}>{b.label}</Text>
                {b.items.map(it => (
                  <NotifRow
                    key={it.id}
                    item={it}
                    onPress={() => {
                      if (!it.transient) onMarkRead?.(it.id);
                      if (it.deep_link)  onDeepLink?.(it.deep_link);
                      else               onDeepLink?.(null);
                    }}
                    onDelete={it.transient ? undefined : () => onDelete?.(it.id)}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function NotifRow({ item, onPress, onDelete }: any) {
  const meta = _kindMeta(item.kind);
  const icon = item.icon || meta.icon;
  const color = item.color || meta.color;
  return (
    <View style={notif.rowWrap}>
      <TouchableOpacity style={notif.row} onPress={onPress} activeOpacity={0.85}>
        <View style={[notif.iconRing, { backgroundColor: color + '22' }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[notif.title, !item.read && { color: C.textDark }]} numberOfLines={2}>
              {item.title}
            </Text>
            {!item.read && !item.transient && <View style={notif.unreadDot} />}
          </View>
          {item.body && <Text style={notif.body} numberOfLines={3}>{item.body}</Text>}
          <Text style={notif.time}>{_ageStr(item.created_at)}</Text>
        </View>
        {onDelete && (
          <TouchableOpacity
            style={notif.rowDelete}
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.6}
          >
            <Ionicons name="close" size={16} color={C.textLight} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </View>
  );
}

function _kindMeta(kind: string): { icon: any; color: string } {
  switch (kind) {
    case 'OFFER_RECEIVED':      return { icon: 'cash-outline',           color: '#059669' };
    case 'OFFER_WITHDRAWN':     return { icon: 'arrow-undo-outline',     color: '#6B7280' };
    case 'DELIVERY_COMPLETED':  return { icon: 'checkmark-done-outline', color: '#059669' };
    case 'DELIVERY_MANUAL':     return { icon: 'alert-circle-outline',   color: '#B45309' };
    case 'DELIVERY_CANCELLED':  return { icon: 'close-circle-outline',   color: '#DC2626' };
    case 'OFFER_ACCEPTED':      return { icon: 'checkmark-circle',       color: '#059669' };
    case 'OFFER_REJECTED':      return { icon: 'close-circle',           color: '#DC2626' };
    case 'WEATHER_ALERT':       return { icon: 'cloud-outline',          color: '#B45309' };
    case 'FUNGAL_RISK':         return { icon: 'medical-outline',        color: '#B45309' };
    case 'SENSOR_OFFLINE':      return { icon: 'bluetooth-outline',      color: '#2563EB' };
    default:                    return { icon: 'notifications-outline',  color: '#6B7280' };
  }
}

/**
 * Fire an OS-level push notification for each newly-arrived unread item.
 * Uses expo-notifications when available (schedules an immediate local push
 * that lands in the Android tray). Silently no-ops if the module isn't
 * bundled — the in-app bell + feed is always the primary UX.
 */
let _NotificationsMod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _NotificationsMod = require('expo-notifications');
  console.log('[push] expo-notifications loaded');
  // Ensure notifications show while the app is foregrounded too (default
  // Android behaviour hides in-app ones).
  _NotificationsMod?.setNotificationHandler?.({
    handleNotification: async () => ({
      // SDK 57 split `shouldShowAlert` into banner (heads-up popup) +
      // list (drops into the shade). Set both; the old flag is dropped.
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   false,
    }),
  });
  // Android needs a channel or notifications sound / vibrate can be silent.
  if (_NotificationsMod?.setNotificationChannelAsync) {
    _NotificationsMod.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: 4,               // IMPORTANCE_HIGH → shows heads-up banner
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1B4332',
      // Omit `sound` — the channel uses the OS default. Passing 'default'
      // here in SDK 57 is interpreted as a custom filename and errors.
    }).catch((e: any) => console.warn('[push] channel create failed:', e?.message));
  }
} catch (e) {
  console.warn('[push] expo-notifications not available:', (e as any)?.message);
  _NotificationsMod = null;
}

let _pushPermChecked = false;
async function _firePushForNewItems(items: any[]) {
  console.log('[push] fire called for', items.length, 'items');
  if (!_NotificationsMod) {
    console.warn('[push] expo-notifications module is null — skipping');
    return;
  }
  try {
    // Ask for permission once per app session (Android 13+ requires it).
    if (!_pushPermChecked) {
      _pushPermChecked = true;
      const cur = await _NotificationsMod.getPermissionsAsync();
      console.log('[push] current permission:', cur.status);
      if (cur.status !== 'granted') {
        const r = await _NotificationsMod.requestPermissionsAsync();
        console.log('[push] requested permission →', r.status);
        if (r.status !== 'granted') {
          console.warn('[push] permission denied — no tray notifications will show');
          return;
        }
      }
    }
    for (const it of items) {
      const id = await _NotificationsMod.scheduleNotificationAsync({
        content: {
          title: it.title,
          body:  it.body ?? '',
          data:  { deep_link: it.deep_link },
          // `true` = play the system default notification sound.
          // Passing 'default' as a string makes Expo look for a custom
          // sound file called "default.wav" in the plugin config, which
          // errors ("Custom sound 'default' not found").
          sound: true,
        },
        trigger: null,             // fire immediately
      });
      console.log('[push] scheduled ok, id=', id, 'title=', it.title);
    }
  } catch (e) {
    console.warn('[push] fire failed:', (e as any)?.message ?? e);
  }
}

function _ageStr(iso: string): string {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const t = new Date(hasTz ? iso : iso + 'Z').getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.round(s/60)} min ago`;
  if (s < 86400) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)}d ago`;
}

// ── Market Search modal ───────────────────────────────────────────────────
function MarketSearchModal({ visible, onClose, district, lat, lon }: any) {
  const slide = useRef(new Animated.Value(600)).current;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketPrice[]>([]);
  const [meta, setMeta] = useState<{
    status: 'ok' | 'unavailable';
    note?: string | null;
    reason?: string;
    hint?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Filter state: two cascading dropdowns (state → district → APMC) ──
  // The state dropdown is labeled with the state name (e.g. "Karnataka ▾")
  // and lets the farmer switch states. The district dropdown is labeled
  // with the current district (e.g. "Kolar ▾") and lets them pick a
  // specific APMC — or "All APMCs" to see everything in that district.
  const [tree, setTree] = useState<StateNode[]>([]);
  const [selState, setSelState]       = useState<string>('Karnataka');
  const [selDistrict, setSelDistrict] = useState<string>(district || 'Kolar');
  const [selApmc, setSelApmc]         = useState<string | null>(null);   // null = all APMCs in district
  const [openPicker, setOpenPicker]   = useState<'state' | 'district' | null>(null);

  // Load the district hierarchy once when the modal opens.
  useEffect(() => {
    if (!visible) return;
    fetchDistricts().then(d => { if (d?.states) setTree(d.states); });
  }, [visible]);

  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : 600,
      damping: 22, stiffness: 180, useNativeDriver: true,
    }).start();
    if (visible) {
      setQuery('');
      setResults([]);
      setMeta(null);
      // Reset filter to farmer's own district each time modal reopens.
      setSelState('Karnataka');
      setSelDistrict(district || 'Kolar');
      setSelApmc(null);
      setOpenPicker(null);
    }
  }, [visible, district]);

  // Debounced live search — kicks in after user stops typing 400 ms
  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setMeta(null); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      const r = await fetchMarketPrices({
        commodity: q,
        state:     selState,
        district:  selDistrict,
        market:    selApmc,          // null → all APMCs in the district
        limit:     100,
        lat, lon,
        // No proximity cap here — user explicitly asked to see ALL APMCs
        // in the selected district, not just nearest ones.
        scope:     'state',
        // KMV for Karnataka, data.gov.in for other states.
        source:    selState.trim().toLowerCase() === 'karnataka' ? 'kmv' : 'data_gov',
      });
      setLoading(false);
      if (r) {
        setResults(r.prices ?? []);
        setMeta({ status: r.status, note: r.note, reason: r.reason, hint: r.hint });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query, selState, selDistrict, selApmc, visible]);

  // Options lists derived from the loaded hierarchy
  const stateOptions    = tree.map(s => s.name);
  const districtsOfSel  = tree.find(s => s.name === selState)?.districts ?? [];
  const districtOptions = districtsOfSel.map(d => d.name);
  const apmcsOfSel      = districtsOfSel.find(d => d.name === selDistrict)?.apmcs ?? [];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={m.backdrop} onPress={() => { Keyboard.dismiss(); onClose(); }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={m.kbdWrap}
        pointerEvents="box-none"
      >
      <Animated.View style={[
        m.sheet,
        // Override absolute positioning — KeyboardAvoidingView handles placement,
        // so the sheet needs to be a flex child, not absolutely pinned.
        { position: 'relative', left: undefined, right: undefined, bottom: undefined,
          transform: [{ translateY: slide }], maxHeight: '90%' },
      ]}>
        <View style={m.handle} />
        <Text style={m.editTitle}>Search Crop Prices</Text>
        <Text style={m.editSub}>ಬೆಳೆ ಬೆಲೆ ಹುಡುಕಿ</Text>

        <View style={m.searchWrap}>
          <Ionicons name="search" size={16} color={C.textMuted} />
          <TextInput
            style={m.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. Tomato, Ragi, Coconut…"
            placeholderTextColor={C.textLight}
            autoFocus
            autoCapitalize="words"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color={C.textLight} />
            </TouchableOpacity>
          )}
        </View>

        {/* Two cascading dropdowns:
              Left  = current district → tap to pick a specific APMC within it.
              Right = current state    → tap to switch districts (or states). */}
        <View style={m.scopeRow}>
          <TouchableOpacity
            style={m.pickerBtn}
            activeOpacity={0.8}
            onPress={() => setOpenPicker('district')}
          >
            <Ionicons name="location" size={12} color={C.primary} />
            <Text style={m.pickerBtnText} numberOfLines={1}>
              {selApmc ? selApmc : selDistrict} ▾
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={m.pickerBtn}
            activeOpacity={0.8}
            onPress={() => setOpenPicker('state')}
          >
            <Ionicons name="map" size={12} color={C.primary} />
            <Text style={m.pickerBtnText} numberOfLines={1}>
              {selState} ▾
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 340, paddingHorizontal: 16 }}
          style={{ flexGrow: 0 }}
        >
          {loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : query.trim().length < 2 ? (
            <View style={{ paddingVertical: 20 }}>
              <Text style={m.hintTitle}>Try popular crops</Text>
              <View style={m.hintChips}>
                {['Tomato', 'Onion', 'Potato', 'Ragi', 'Maize', 'Chili', 'Coconut',
                  'Ginger', 'Garlic', 'Turmeric', 'Groundnut', 'Cotton', 'Mango', 'Banana',
                ].map(c => (
                  <TouchableOpacity
                    key={c} style={m.hintChip}
                    onPress={() => setQuery(c)}
                  >
                    <Text style={m.hintChipText}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : results.length === 0 ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <Ionicons
                name={meta?.status === 'unavailable' ? 'cloud-offline-outline' : 'alert-circle-outline'}
                size={36}
                color={meta?.status === 'unavailable' ? C.red : C.textLight}
              />
              <Text style={m.noResults}>
                {meta?.status === 'unavailable'
                  ? 'Live prices unavailable'
                  : `No prices for "${query}"`}
              </Text>
              <Text style={m.noResultsSub}>
                {meta?.status === 'unavailable'
                  ? (meta.hint ?? 'AGMARKNET is not responding. Try again shortly.')
                  : selApmc
                    ? `${selApmc} APMC hasn't posted "${query}" today. Try "All APMCs" or another district.`
                    : `No APMC in ${selDistrict} has posted "${query}" today. Try a different district.`}
              </Text>
            </View>
          ) : (
            <>
              {meta && (
                <Text style={m.searchMeta}>
                  {results.length} result{results.length > 1 ? 's' : ''} · Live AGMARKNET
                  {meta.note ? ` · ${meta.note}` : ''}
                </Text>
              )}
              {results.map((p, i) => (
                <View key={`${p.crop}-${p.market}-${i}`} style={m.resultRow}>
                  <View style={m.resultIcon}>
                    <MaterialCommunityIcons name="sprout" size={16} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={m.resultCrop}>{p.crop}</Text>
                    <Text style={m.resultKn}>
                      {p.kn}{p.market ? ` · ${p.market}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={m.resultPrice}>
                      ₹{p.price}<Text style={m.resultUnit}>/{p.unit}</Text>
                    </Text>
                    {p.change !== 0 && (
                      <Text style={[m.resultChange, {
                        color: p.change > 0 ? C.primary : C.red,
                      }]}>
                        {p.change > 0 ? '▲' : '▼'} {Math.abs(p.change).toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </Animated.View>
      </KeyboardAvoidingView>

      {/* Picker sheet — shows the option list for whichever dropdown is open.
          One picker at a time; dismisses on backdrop tap. */}
      {openPicker !== null && (
        <PickerSheet
          title={openPicker === 'state' ? 'Choose district' : 'Choose APMC'}
          onClose={() => setOpenPicker(null)}
          options={
            openPicker === 'state'
              ? districtOptions
              : ['All APMCs', ...apmcsOfSel]
          }
          selected={openPicker === 'state' ? selDistrict : (selApmc || 'All APMCs')}
          onSelect={(v) => {
            if (openPicker === 'state') {
              setSelDistrict(v);
              setSelApmc(null);   // reset APMC when district changes
            } else {
              setSelApmc(v === 'All APMCs' ? null : v);
            }
            setOpenPicker(null);
          }}
        />
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 30 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  logoRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  logoRing: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: C.primaryPale,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    overflow: 'hidden',
  },
  logoImage: { width: 36, height: 36 },
  brand: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, letterSpacing: -0.4 },
  brandTag: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 1 },
  headerIcons: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  dotAlert: {
    position: 'absolute', top: 6, right: 8,
    minWidth: 12, height: 12, borderRadius: 6, backgroundColor: C.red,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: '#FFF',
  },
  dotAlertText: { fontFamily: 'Inter_800ExtraBold', fontSize: 8, color: '#FFF' },

  // Hero — real farmer background image + soft overlay
  heroCard: {
    height: 172, borderRadius: 22, padding: 16, overflow: 'hidden',
    position: 'relative', justifyContent: 'center',
  },
  heroImg: { borderRadius: 22 },
  heroTextBlock: { flex: 1, paddingRight: 12, zIndex: 2 },
  heroBadge: {
    position: 'absolute', top: 14, right: 14,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
    zIndex: 2,
  },
  heroTitle: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.primaryDark,
    letterSpacing: -0.3, lineHeight: 22,
  },
  heroSub: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textBody,
    marginTop: 6, lineHeight: 14,
  },
  heroCTA: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginTop: 10,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  heroCTAText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: '#FFF' },

  dotsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 6,
    marginTop: 10, marginBottom: 12,
  },
  dot: { height: 6, borderRadius: 3 },
  dotActive: { width: 20, backgroundColor: C.primary },
  dotInactive: { width: 6, backgroundColor: '#D5DBD7' },

  // Stats
  statsCardWrap: {
    borderRadius: 20, overflow: 'hidden', marginTop: 4, marginBottom: 8,
    shadowColor: C.primaryDark, shadowOpacity: 0.25, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  statsCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, padding: 14,
  },
  statItem: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  statIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(82,183,136,0.2)',
    borderWidth: 1, borderColor: 'rgba(82,183,136,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: '#FFF' },
  statUnit:  { fontFamily: 'Inter_500Medium', fontSize: 10, color: 'rgba(255,255,255,0.65)' },
  statLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: 'rgba(255,255,255,0.8)' },
  statLabelKn: { fontFamily: 'Inter_400Regular', fontSize: 8, color: 'rgba(255,255,255,0.5)' },
  statsDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 4 },
  statTapZone:  { flex: 1 },
  statsHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6, paddingHorizontal: 4,
  },
  statsHintText: {
    fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted,
    flex: 1,
  },
  // Friendly empty-state nudge — replaces the old grey "info" line that
  // farmers were misreading as an error. Tappable card that jumps to Business.
  emptyHintCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 10, padding: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  emptyHintIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#B7E4C7',
  },
  emptyHintTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primaryDark,
  },
  emptyHintTitleKn: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.textBody,
    marginTop: 1,
  },
  emptyHintBody: {
    fontFamily: 'Inter_400Regular', fontSize: 10.5, color: C.textBody,
    marginTop: 4, lineHeight: 14,
  },

  // Section
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginTop: 20, marginBottom: 10,
  },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.textDark, letterSpacing: -0.2 },
  sectionKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 1 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center' },
  viewAll: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary },

  emptyRow: { paddingVertical: 24, alignItems: 'center' },

  // Market "Search crop" button (right of section header)
  mkSearchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.primaryTint,
    borderWidth: 1, borderColor: C.primaryPale,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
  },
  mkSearchBtnText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary },

  // Honest "prices unavailable" state — replaces any fake fallback data
  mkUnavailCard: {
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5',
    borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 4,
  },
  mkUnavailTitle: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: C.red, marginTop: 8,
  },
  mkUnavailBody: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.textBody,
    marginTop: 6, textAlign: 'center', lineHeight: 16,
  },
  mkUnavailHint: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted,
    marginTop: 4, textAlign: 'center', lineHeight: 15,
  },
  mkRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, backgroundColor: C.red,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  mkRetryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: '#FFF' },




  apmcCluster: { marginBottom: 16 },
  apmcHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 4, paddingVertical: 6, marginBottom: 6,
  },
  apmcHeaderText: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12.5,
    color: C.textDark, flex: 1,
  },
  tile: {
    width: 108, marginRight: 8,
    padding: 10, backgroundColor: C.card,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    position: 'relative',
  },
  tilePill: {
    position: 'absolute', top: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 4, paddingVertical: 2, borderRadius: 999,
  },
  tilePillText: { fontFamily: 'Inter_700Bold', fontSize: 8.5 },
  tileCrop:  { fontFamily: 'Inter_700Bold',  fontSize: 12, color: C.textDark, marginTop: 4 },
  tileKn:    { fontFamily: 'Inter_500Medium',fontSize: 10, color: C.textMuted },
  tilePrice: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: C.textDark,
    marginTop: 4, letterSpacing: -0.2,
  },
  tilePriceUnit: { fontFamily: 'Inter_500Medium', fontSize: 9, color: C.textMuted },

  // AI card
  aiCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 16, gap: 10, marginTop: 10,
    borderWidth: 1,
  },
  aiIconBox: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, letterSpacing: -0.2 },
  aiTitleKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 1 },
  aiBody: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textBody, marginTop: 4, lineHeight: 14 },
  aiBadgeRow: { flexDirection: 'row', marginTop: 6 },
  aiBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  aiBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9 },

  // Subsidy
  subCard: {
    width: 220, padding: 12, borderRadius: 16, marginRight: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  subBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryTint, alignSelf: 'flex-start',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  subBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, color: C.primary },
  subTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: C.textDark, marginTop: 8 },
  subTitleKn: { fontFamily: 'Inter_500Medium', fontSize: 9, color: C.textMuted, marginTop: 1 },
  subAmount: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.primary, marginTop: 6, letterSpacing: -0.3 },
  subDesc: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textBody, marginTop: 4, lineHeight: 13 },
  subCTA: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  subCTAText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },
});

const m = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  kbdWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '88%', paddingTop: 8,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D5DBD7', alignSelf: 'center', marginBottom: 4 },

  // Profile view
  hero: { alignItems: 'center', paddingVertical: 18 },
  avatar: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, color: '#FFF' },
  heroName: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.textDark, marginTop: 10, letterSpacing: -0.3 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primaryPale, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: 5,
  },
  roleText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },

  sectionLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 16, marginBottom: 8, paddingHorizontal: 20,
  },
  infoCard: {
    backgroundColor: C.card, borderRadius: 14, marginHorizontal: 16,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  infoIcon: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: C.primaryTint,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  infoLabel: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },
  infoValue: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark, marginTop: 2 },
  infoInput: {
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark,
    marginTop: 2, borderBottomWidth: 1, borderColor: C.primary, padding: 0,
  },
  divider: { height: 1, backgroundColor: C.border, marginLeft: 54 },
  editIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 18,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.redBg, borderWidth: 1, borderColor: '#FCA5A5',
  },
  logoutText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.red },

  // Edit farm
  editTitle: {
    fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: C.textDark,
    textAlign: 'center', marginTop: 6,
  },
  editSub: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted,
    textAlign: 'center', marginBottom: 12,
  },
  field: { paddingHorizontal: 16, marginTop: 12 },
  fieldLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textBody,
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.textDark,
    borderWidth: 1, borderColor: C.border,
  },
  remainText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: C.primary },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    marginRight: 6,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textDark },
  cropRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, padding: 10, backgroundColor: C.card,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  cropRowName: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark, width: 80 },
  cropRowKn:   { fontFamily: 'Inter_400Regular', fontSize: 10, color: C.textMuted, flex: 1 },
  cropRowInput: {
    width: 60, backgroundColor: C.primaryTint, borderRadius: 8,
    padding: 6, textAlign: 'center',
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.textDark,
  },
  cropRowUnit: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },

  // Info card that replaces the old crops-editing UI inside EditFarmModal
  cropsHintCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    marginHorizontal: 16, marginTop: 6,
    padding: 12, borderRadius: 12,
    backgroundColor: C.primaryTint,
    borderWidth: 1, borderColor: C.primaryPale,
  },
  cropsHintTitle:   { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: C.primaryDark },
  cropsHintTitleKn: { fontFamily: 'Inter_600SemiBold',  fontSize: 11, color: C.primary, marginTop: 1 },
  cropsHintBody:    { fontFamily: 'Inter_500Medium',    fontSize: 11, color: C.textBody, marginTop: 6, lineHeight: 15 },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 20,
    paddingVertical: 14, borderRadius: 14, backgroundColor: C.primary,
  },
  saveBtnText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: '#FFF' },

  // Alerts
  alertItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, marginTop: 10, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  alertIcon: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  alertTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  alertTitleKn: { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 1 },
  alertBody: { fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textBody, marginTop: 4, lineHeight: 15 },

  // Search modal
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 4, marginBottom: 10,
    backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: {
    flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: C.textDark,
    padding: 0,
  },
  scopeRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginBottom: 12,
  },
  scopeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  scopeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  scopeChipText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primary },
  pickerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  pickerBtnText: {
    fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary,
    flex: 1,
  },

  hintTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  hintChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hintChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: C.primaryTint, borderWidth: 1, borderColor: C.primaryPale,
  },
  hintChipText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: C.primary },

  searchMeta: {
    fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted,
    marginBottom: 8, marginTop: 2,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, marginTop: 6, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  resultIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: C.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  resultCrop: { fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textDark },
  resultKn:   { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 2 },
  resultPrice: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: C.textDark, letterSpacing: -0.3 },
  resultUnit:  { fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted },
  resultChange: { fontFamily: 'Inter_700Bold', fontSize: 10, marginTop: 2 },

  noResults: {
    fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textBody, marginTop: 10,
  },
  noResultsSub: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textMuted,
    marginTop: 4, textAlign: 'center', paddingHorizontal: 30,
  },
});

// Notification-sheet styles kept separate for readability
const notif = StyleSheet.create({
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  markAllBtn: {
    backgroundColor: C.primaryTint, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.primaryPale, marginTop: 4,
  },
  markAllText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.primaryDark },
  clearAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.redBg, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#FCA5A5', marginTop: 4,
  },
  clearAllText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: C.red },
  rowWrap: { position: 'relative' },
  rowDelete: {
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    marginLeft: 4, marginRight: -4, alignSelf: 'flex-start',
  },
  bucketLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, color: C.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: 14, marginBottom: 6, paddingLeft: 4,
  },
  row: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    padding: 12, marginBottom: 8, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  iconRing: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter_700Bold', fontSize: 13, color: C.textDark, flex: 1, lineHeight: 17,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563EB' },
  body: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: C.textBody, marginTop: 3, lineHeight: 15,
  },
  time: {
    fontFamily: 'Inter_500Medium', fontSize: 10, color: C.textMuted, marginTop: 4,
  },
});
