/**
 * Discover tab — Mandi buyer app (Amazon/Flipkart-inspired dense layout).
 *
 * Design goals:
 *   - Sticky search + delivery-to header (like Amazon's top bar)
 *   - Promo strip (like Flipkart's deals ribbon)
 *   - Category tile grid (like BigBasket / Blinkit)
 *   - Rich product cards with prominent price, badges, quick actions
 *   - Zero hardcoded data — everything traces to backend
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Linking, Alert, Dimensions, Image,
  Modal, Pressable, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather, FontAwesome5 } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import {
  searchNearbyListings, ageLabel, parseServerTs, resolvePhotoUrl,
  fetchBuyerNotifications, markBuyerNotificationRead, markAllBuyerNotificationsRead,
  deleteBuyerNotification, clearAllBuyerNotifications,
  type CommerceListing, type NotificationsFeed, type NotificationItem,
} from '../../lib/api';
import { useAuth } from '../../hooks/use-auth';

// Lazy expo-location so the app runs even if the module isn't bundled
let Location: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Location = require('expo-location');
} catch { Location = null; }

const { width: SCREEN_W } = Dimensions.get('window');

// Category tiles — buyer-oriented product families
const CATEGORIES = [
  { key: 'All',        emoji: '🛒', label: 'All',        color: '#FEF3C7' },
  { key: 'Tomato',     emoji: '🍅', label: 'Tomato',     color: '#FEE2E2' },
  { key: 'Onion',      emoji: '🧅', label: 'Onion',      color: '#F5F3FF' },
  { key: 'Potato',     emoji: '🥔', label: 'Potato',     color: '#FEF3C7' },
  { key: 'Ragi',       emoji: '🌾', label: 'Ragi',       color: '#FEF3C7' },
  { key: 'Chili',      emoji: '🌶️', label: 'Chili',      color: '#FEE2E2' },
  { key: 'Maize',      emoji: '🌽', label: 'Maize',      color: '#FEF9C3' },
  { key: 'Cabbage',    emoji: '🥬', label: 'Cabbage',    color: '#D1FAE5' },
  { key: 'Carrot',     emoji: '🥕', label: 'Carrot',     color: '#FFEDD5' },
  { key: 'Coriander',  emoji: '🌿', label: 'Herbs',      color: '#D1FAE5' },
];

const RADII_KM = [5, 10, 25, 50];

const CROP_EMOJI: Record<string, string> = {
  Tomato: '🍅', Onion: '🧅', Potato: '🥔', Ragi: '🌾', Maize: '🌽',
  Chili: '🌶️', Wheat: '🌾', Rice: '🌾', Cotton: '🌱', Sugarcane: '🎋',
  Groundnut: '🥜', Brinjal: '🍆', Carrot: '🥕', Cabbage: '🥬',
  Coriander: '🌿',
};

const fmtIN    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtPrice = (n: number) => `₹${n.toFixed(2)}`;

export default function DiscoverScreen() {
  const [listings, setListings] = useState<CommerceListing[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string>('your area');
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [cropFilter, setCropFilter] = useState<string>('All');
  const [searchQ, setSearchQ] = useState<string>('');
  const [notifs, setNotifs] = useState<NotificationsFeed | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const isFirstNotifLoadRef = useRef(true);

  // Auth-gate every backend call. Without this gate, /notifications/buyer
  // fires during the tiny cold-boot window (before AsyncStorage has handed
  // back the JWT) AND during the tail of a sign-out flow (before the 60s
  // interval clears), both of which hit the server with no Bearer header
  // and get a truthful 401 back — noisy in Metro logs and wasted server work.
  const auth = useAuth();

  // Notifications: fetch on mount + focus + every 60s while logged in.
  // New items fire an OS tray push via expo-notifications.
  const loadNotifs = useCallback(async () => {
    if (!auth.token) return;   // no JWT yet — skip the round-trip entirely
    const n = await fetchBuyerNotifications();
    if (!n) return;
    setNotifs(n);
    const newIds: any[] = [];
    for (const item of n.items) {
      if (!seenNotifIdsRef.current.has(item.id)) {
        newIds.push(item);
        seenNotifIdsRef.current.add(item.id);
      }
    }
    if (!isFirstNotifLoadRef.current && newIds.length > 0) {
      _firePushForNewItems(newIds);
    }
    isFirstNotifLoadRef.current = false;
  }, [auth.token]);
  useEffect(() => {
    // Wait for auth to actually resolve before starting the poll. When the
    // farmer signs out, `auth.token` flips to null and this effect re-runs,
    // clearing the interval and stopping the noise.
    if (!auth.token) return;
    loadNotifs();
    const t = setInterval(loadNotifs, 60_000);
    return () => clearInterval(t);
  }, [loadNotifs, auth.token]);
  useFocusEffect(useCallback(() => {
    if (auth.token) loadNotifs();
  }, [loadNotifs, auth.token]));

  // GPS + reverse-geocode → "Delivering to Kolar"
  useEffect(() => {
    (async () => {
      if (!Location) { setGps({ lat: 13.1367, lng: 78.1325 }); return; }
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setGps({ lat: 13.1367, lng: 78.1325 }); return; }
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude });
        try {
          const r = await Location.reverseGeocodeAsync({
            latitude: p.coords.latitude, longitude: p.coords.longitude,
          });
          const first = r?.[0];
          if (first) setPlaceLabel(first.city || first.subregion || first.district || 'your area');
        } catch {}
      } catch { setGps({ lat: 13.1367, lng: 78.1325 }); }
    })();
  }, []);

  // Search bar takes priority over the chip filter. If the buyer types
  // anything, that wins — the chip is treated as "off". Prevents the bug
  // where "Tomato" chip stays selected and swallows a search for "Onion".
  const [searching, setSearching] = useState(false);
  const reqSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!gps) return;
    const typed = searchQ.trim();
    const cropQ = typed
      ? typed
      : (cropFilter !== 'All' ? cropFilter : undefined);
    // Guard against out-of-order responses: only the most recent request
    // is allowed to update state. Older ones (still in-flight from earlier
    // keystrokes) silently drop their result.
    const mySeq = ++reqSeqRef.current;
    setSearching(true);
    const r = await searchNearbyListings({
      lat: gps.lat, lng: gps.lng, radiusKm, crop: cropQ,
    });
    if (mySeq !== reqSeqRef.current) return;
    setListings(r ?? []);
    setSearching(false);
  }, [gps, radiusKm, cropFilter, searchQ]);

  // Debounce: fire the search 350 ms after the last keystroke instead of
  // spamming the backend on every letter. `load` itself is memoised, so this
  // effect re-runs only when a dependency actually changes.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, searchQ.trim() ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, searchQ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Amazon-style sticky header — solid amber, location + search */}
      <View style={s.stickyHeader}>
        <View style={s.locationRow}>
          <Ionicons name="location-sharp" size={14} color="#FFFFFF" />
          <View style={{ flex: 1 }}>
            <Text style={s.deliverToLabel}>Sourcing near · ಹತ್ತಿರ</Text>
            <Text style={s.deliverToPlace} numberOfLines={1}>{placeLabel}</Text>
          </View>
          <TouchableOpacity
            style={s.bellBtn}
            onPress={async () => {
              setShowNotifs(true);
              if ((notifs?.unread ?? 0) > 0) {
                await markAllBuyerNotificationsRead();
                loadNotifs();
              }
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="notifications" size={16} color="#FFFFFF" />
            {(notifs?.unread ?? 0) > 0 && (
              <View style={s.bellBadge}>
                <Text style={s.bellBadgeText}>{Math.min(notifs?.unread ?? 0, 99)}</Text>
              </View>
            )}
          </TouchableOpacity>
          <View style={s.radiusBadge}>
            <Text style={s.radiusBadgeText}>{radiusKm} km</Text>
          </View>
        </View>

        <View style={s.searchBar}>
          <Ionicons name="search" size={16} color={COLORS.textMuted} />
          <TextInput
            style={s.searchInput}
            value={searchQ}
            onChangeText={(v) => {
              setSearchQ(v);
              // A search query overrides the chip — reset it so results
              // reflect what the buyer typed, not a stale chip selection.
              if (v.trim() && cropFilter !== 'All') setCropFilter('All');
            }}
            placeholder="Search Tomato, Ragi, Onion..."
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="words"
          />
          {searching
            ? <ActivityIndicator size="small" color={COLORS.textMuted} />
            : searchQ.length > 0
              ? <TouchableOpacity onPress={() => setSearchQ('')}>
                  <Ionicons name="close-circle" size={17} color={COLORS.textMuted} />
                </TouchableOpacity>
              : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
        // Discover feed can be dozens of listing cards with photos —
        // clip off-screen ones to keep scroll paint cheap on Android.
        removeClippedSubviews
      >
        {/* Promo strip — Flipkart-style deals ribbon */}
        <View style={s.promoStrip}>
          <View style={s.promoIcon}>
            <MaterialCommunityIcons name="lightning-bolt" size={16} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.promoTitle}>Fair-price guaranteed</Text>
            <Text style={s.promoSub}>Every listing sits within ±5% of AGMARKNET</Text>
          </View>
        </View>

        {/* Category tiles — BigBasket/Blinkit style */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Shop by crop</Text>
          <Text style={s.sectionKn}>ಬೆಳೆ ಮೂಲಕ</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {CATEGORIES.map(c => {
            const active = cropFilter === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={s.catTile}
                onPress={() => setCropFilter(c.key)}
                activeOpacity={0.8}
              >
                <View style={[s.catCircle, { backgroundColor: c.color }, active && s.catCircleActive]}>
                  <Text style={{ fontSize: 26 }}>{c.emoji}</Text>
                </View>
                <Text style={[s.catLabel, active && s.catLabelActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Radius selector */}
        <View style={s.radiusRow}>
          <Ionicons name="radio-outline" size={13} color={COLORS.textMuted} />
          <Text style={s.radiusLabel}>Radius:</Text>
          {RADII_KM.map(r => (
            <TouchableOpacity
              key={r}
              style={[s.radiusChip, radiusKm === r && s.radiusChipActive]}
              onPress={() => setRadiusKm(r)}
            >
              <Text style={[s.radiusChipText, radiusKm === r && s.radiusChipTextActive]}>
                {r} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Section header for listings */}
        <View style={s.sectionHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionTitle}>
              {cropFilter === 'All' ? 'Fresh listings' : `${cropFilter} available`}
            </Text>
            <Text style={s.sectionKn}>ತಾಜಾ ಪಟ್ಟಿಗಳು</Text>
          </View>
          {listings && listings.length > 0 && (
            <View style={s.countPill}>
              <Text style={s.countText}>{listings.length}</Text>
            </View>
          )}
        </View>

        {/* Results */}
        {gps == null && <ActivityIndicator style={{ marginVertical: 24 }} color={COLORS.primary} />}
        {gps && listings == null && <ActivityIndicator style={{ marginVertical: 24 }} color={COLORS.primary} />}

        {listings && listings.length === 0 && (
          <EmptyResults
            radiusKm={radiusKm}
            onWiden={() => {
              const next = RADII_KM.find(r => r > radiusKm);
              if (next) setRadiusKm(next);
              else Alert.alert('Max radius reached', 'Try a different crop or search term.');
            }}
          />
        )}

        {listings && listings.map(l => (
          <ListingCard key={l.id} listing={l} onPress={() => router.push(`/crop-detail?id=${l.id}`)} />
        ))}

        <View style={{ height: 20 }} />
      </ScrollView>

      <NotificationsSheet
        visible={showNotifs}
        onClose={() => setShowNotifs(false)}
        feed={notifs}
        onMarkRead={async (id: string) => { await markBuyerNotificationRead(id); loadNotifs(); }}
        onMarkAllRead={async () => { await markAllBuyerNotificationsRead(); loadNotifs(); }}
        onDelete={async (id: string) => { await deleteBuyerNotification(id); loadNotifs(); }}
        onClearAll={async () => {
          await clearAllBuyerNotifications();
          seenNotifIdsRef.current.clear();
          loadNotifs();
        }}
        onDeepLink={(link: string | null) => {
          setShowNotifs(false);
          if (link) router.push(link as any);
        }}
      />
    </SafeAreaView>
  );
}

// ── Notifications sheet (YouTube-style) ────────────────────────────────────
function NotificationsSheet({
  visible, onClose, feed, onMarkRead, onMarkAllRead, onDelete, onClearAll, onDeepLink,
}: {
  visible: boolean; onClose: () => void;
  feed: NotificationsFeed | null;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onDeepLink: (link: string | null) => void;
}) {
  const slide = useRef(new Animated.Value(600)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: visible ? 0 : 600, damping: 22, stiffness: 180, useNativeDriver: true }).start();
  }, [visible]);

  const items = feed?.items ?? [];
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const buckets: { label: string; items: NotificationItem[] }[] = [
    { label: 'Today',     items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier',   items: [] },
  ];
  for (const it of items) {
    const t = parseServerTs(it.created_at);
    if (t >= startOfToday.getTime())          buckets[0].items.push(it);
    else if (t >= startOfYesterday.getTime()) buckets[1].items.push(it);
    else                                       buckets[2].items.push(it);
  }
  const unread = feed?.unread ?? 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={ns.backdrop} onPress={onClose} />
      <Animated.View style={[ns.sheet, { transform: [{ translateY: slide }] }]}>
        <View style={ns.handle} />
        <View style={ns.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={ns.title}>Notifications</Text>
            <Text style={ns.sub}>
              {(feed?.total ?? 0) === 0 ? 'All caught up 🎉' : `${feed?.total ?? 0} in feed`}
            </Text>
          </View>
          {(feed?.total ?? 0) > 0 && (
            <TouchableOpacity style={ns.clearAll} onPress={onClearAll} activeOpacity={0.85}>
              <Ionicons name="trash-outline" size={12} color={COLORS.accentRed} />
              <Text style={ns.clearAllText}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {items.length === 0 ? (
            <View style={ns.empty}>
              <Ionicons name="notifications-outline" size={44} color={COLORS.textMuted} />
              <Text style={ns.emptyTitle}>You're all caught up</Text>
              <Text style={ns.emptySub}>
                Farmer replies, deliveries and cancellations appear here.
              </Text>
            </View>
          ) : (
            buckets.map(b => b.items.length > 0 && (
              <View key={b.label}>
                <Text style={ns.bucket}>{b.label}</Text>
                {b.items.map(it => {
                  const meta = _mandiKindMeta(it.kind);
                  return (
                    <TouchableOpacity
                      key={it.id}
                      style={ns.row}
                      activeOpacity={0.85}
                      onPress={() => {
                        onMarkRead(it.id);
                        onDeepLink(it.deep_link ?? null);
                      }}
                    >
                      <View style={[ns.iconRing, { backgroundColor: meta.color + '22' }]}>
                        <Ionicons name={meta.icon} size={18} color={meta.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={ns.rowTitle} numberOfLines={2}>{it.title}</Text>
                          {!it.read && <View style={ns.unreadDot} />}
                        </View>
                        {it.body && <Text style={ns.rowBody} numberOfLines={3}>{it.body}</Text>}
                        <Text style={ns.rowTime}>{_mandiAge(it.created_at)}</Text>
                      </View>
                      <TouchableOpacity
                        style={ns.rowDelete}
                        onPress={() => onDelete(it.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function _mandiKindMeta(kind: string): { icon: any; color: string } {
  switch (kind) {
    case 'OFFER_ACCEPTED':     return { icon: 'checkmark-circle',       color: '#059669' };
    case 'OFFER_REJECTED':     return { icon: 'close-circle',           color: '#DC2626' };
    case 'DELIVERY_CANCELLED': return { icon: 'close-circle-outline',   color: '#DC2626' };
    case 'DELIVERY_MANUAL':    return { icon: 'alert-circle-outline',   color: '#B45309' };
    default:                   return { icon: 'notifications-outline',  color: '#6B7280' };
  }
}
// ── Push helper (mirror of Upaj's) — fires OS tray notifications for new items
let _NotifsMod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _NotifsMod = require('expo-notifications');
  console.log('[push] expo-notifications loaded (mandi)');
  _NotifsMod?.setNotificationHandler?.({
    handleNotification: async () => ({
      // SDK 57 split `shouldShowAlert` into banner + list. Drop the old flag.
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   false,
    }),
  });
  if (_NotifsMod?.setNotificationChannelAsync) {
    _NotifsMod.setNotificationChannelAsync('default', {
      name: 'Default', importance: 4,
      vibrationPattern: [0, 250, 250, 250], lightColor: '#D97706',
      // Omit `sound` — SDK 57 treats a string here as a custom filename.
    }).catch((e: any) => console.warn('[push] channel create failed:', e?.message));
  }
} catch (e) {
  console.warn('[push] expo-notifications not available:', (e as any)?.message);
  _NotifsMod = null;
}
let _permChecked = false;
async function _firePushForNewItems(items: any[]) {
  console.log('[push] fire called for', items.length, 'items (mandi)');
  if (!_NotifsMod) { console.warn('[push] module null'); return; }
  try {
    if (!_permChecked) {
      _permChecked = true;
      const cur = await _NotifsMod.getPermissionsAsync();
      console.log('[push] current permission:', cur.status);
      if (cur.status !== 'granted') {
        const r = await _NotifsMod.requestPermissionsAsync();
        console.log('[push] requested →', r.status);
        if (r.status !== 'granted') return;
      }
    }
    for (const it of items) {
      const id = await _NotifsMod.scheduleNotificationAsync({
        content: {
          title: it.title,
          body:  it.body ?? '',
          data:  { deep_link: it.deep_link },
          sound: true,          // system default sound (NOT the string 'default')
        },
        trigger: null,
      });
      console.log('[push] scheduled id=', id, 'title=', it.title);
    }
  } catch (e) {
    console.warn('[push] fire failed:', (e as any)?.message ?? e);
  }
}

function _mandiAge(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - parseServerTs(iso)) / 1000));
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.round(s/60)} min ago`;
  if (s < 86400) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)}d ago`;
}

function EmptyResults({ radiusKm, onWiden }: { radiusKm: number; onWiden: () => void }) {
  return (
    <View style={s.empty}>
      <MaterialCommunityIcons name="basket-outline" size={48} color={COLORS.textMuted} />
      <Text style={s.emptyTitle}>No listings within {radiusKm} km</Text>
      <Text style={s.emptyTitleKn}>{radiusKm} ಕಿಮೀಯಲ್ಲಿ ಯಾವ ಪಟ್ಟಿಗಳಿಲ್ಲ</Text>
      <Text style={s.emptyMsg}>
        Try widening the search radius or clearing the crop filter.
      </Text>
      <TouchableOpacity style={s.emptyBtn} onPress={onWiden} activeOpacity={0.85}>
        <Text style={s.emptyBtnText}>Widen radius</Text>
      </TouchableOpacity>
    </View>
  );
}

function ListingCard({ listing, onPress }: { listing: CommerceListing; onPress: () => void }) {
  const emoji = CROP_EMOJI[listing.crop_name] || '🌱';
  const age = ageLabel(listing.created_at).en;
  const total = listing.price_per_kg * listing.quantity_kg;
  const belowBenchmark = listing.benchmark_price != null
    && listing.price_verified
    && listing.price_per_kg < listing.benchmark_price;
  const savings = belowBenchmark
    ? Math.round(((listing.benchmark_price! - listing.price_per_kg) / listing.benchmark_price!) * 100)
    : 0;
  const photoUrl = resolvePhotoUrl(listing.photo_url);

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.9}>
      {/* Left visual — real crop photo when available, emoji fallback */}
      <View style={s.cardEmojiWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.cardPhoto} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 44 }}>{emoji}</Text>
        )}
        {belowBenchmark && (
          <View style={s.savingsRibbon}>
            <Text style={s.savingsText}>{savings}% off</Text>
          </View>
        )}
        {listing.photos && listing.photos.length > 1 && (
          <View style={s.photoBadge}>
            <Ionicons name="images" size={9} color="#FFF" />
            <Text style={s.photoBadgeText}>+{listing.photos.length - 1}</Text>
          </View>
        )}
      </View>

      {/* Body */}
      <View style={s.cardBody}>
        <Text style={s.cardCrop} numberOfLines={1}>{listing.crop_name}</Text>
        {listing.crop_name_kn && (
          <Text style={s.cardCropKn} numberOfLines={1}>{listing.crop_name_kn}</Text>
        )}

        {/* Price line — Amazon-style: big price + strikethrough benchmark */}
        <View style={s.priceRow}>
          <Text style={s.cardPrice}>{fmtPrice(listing.price_per_kg)}</Text>
          <Text style={s.cardPriceUnit}>/kg</Text>
          {belowBenchmark && (
            <Text style={s.cardPriceStrike}>
              {fmtPrice(listing.benchmark_price!)}
            </Text>
          )}
        </View>

        {/* Where the farmer is — plain text, no pill chrome. Village first
            (buyers recognise it), km after. Single line, quiet. */}
        <View style={s.metaLine}>
          <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
          <Text style={s.metaLineText} numberOfLines={1}>
            {listing.village || 'Farm'}
            {listing.distance_km != null ? `  ·  ${listing.distance_km.toFixed(1)} km away` : ''}
          </Text>
        </View>

        {/* Farmer trust line — rating stars + sales count, or "new farmer" hint. */}
        {listing.farmer_rating != null && listing.farmer_rating_count > 0 ? (
          <View style={s.metaLine}>
            <Ionicons name="star" size={11} color="#D97706" />
            <Text style={[s.metaLineText, { color: '#B45309', fontWeight: '700' }]} numberOfLines={1}>
              {listing.farmer_rating.toFixed(1)} · {listing.farmer_rating_count} {listing.farmer_rating_count === 1 ? 'sale' : 'sales'}
            </Text>
          </View>
        ) : (
          <View style={s.metaLine}>
            <Ionicons name="sparkles-outline" size={11} color={COLORS.textMuted} />
            <Text style={s.metaLineText} numberOfLines={1}>New farmer</Text>
          </View>
        )}

        {/* Price anchor — one compact line, only when we have real fit data.
            Removes the old "Unverified" badge (backend already treats KMV-anchored
            listings as verified) and the separate "Fair Price" pill (redundant
            with this line's green tone). Absent = manual price, no chrome. */}
        {listing.market_source_apmc && (
          <View style={s.metaLine}>
            <Ionicons name="checkmark-circle" size={11} color={COLORS.accentGreen} />
            <Text style={[s.metaLineText, { color: COLORS.accentGreen, fontWeight: '700' }]} numberOfLines={1}>
              {listing.market_source_apmc} APMC rate
              {listing.market_source_date ? `  ·  ${listing.market_source_date}` : ''}
            </Text>
          </View>
        )}

        <View style={s.cardBottom}>
          <Text style={s.cardMeta}>
            {listing.quantity_kg} kg  ·  {age}
          </Text>
          <Text style={s.cardTotal}>{fmtIN(total)}</Text>
        </View>

        {/* Amazon-style quick-action row */}
        {listing.farmer_phone ? (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.callBtn}
              onPress={() => Linking.openURL(`tel:${listing.farmer_phone}`)}
              activeOpacity={0.85}
            >
              <Ionicons name="call" size={12} color={COLORS.primaryDark} />
              <Text style={s.callBtnText}>Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.offerBtn} onPress={onPress} activeOpacity={0.85}>
              <MaterialCommunityIcons name="handshake" size={12} color="#FFFFFF" />
              <Text style={s.offerBtnText}>Make Offer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={s.offerBtnFull} onPress={onPress} activeOpacity={0.85}>
            <Text style={s.offerBtnText}>View · Make Offer</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { paddingBottom: 100 },

  // Sticky header — Amazon amber top bar
  stickyHeader: {
    backgroundColor: COLORS.primary,
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  deliverToLabel: {
    fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)',
  },
  deliverToPlace: {
    fontSize: 14, fontWeight: '800', color: '#FFFFFF', marginTop: 1,
  },
  radiusBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  radiusBadgeText: {
    fontSize: 11, fontWeight: '800', color: '#FFFFFF',
  },
  bellBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.accentRed, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.primary,
  },
  bellBadgeText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: RADII.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: {
    flex: 1, fontSize: 13, color: COLORS.textDark, paddingVertical: 0,
  },

  // Promo strip
  promoStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 12, marginHorizontal: 16, padding: 12,
    backgroundColor: '#FFFBEB', borderRadius: RADII.md,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  promoIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  promoTitle: {
    fontSize: 13, fontWeight: '800', color: COLORS.primaryDark,
  },
  promoSub: {
    fontSize: 10, color: COLORS.textBody, marginTop: 1, fontWeight: '500',
  },

  // Section headers
  sectionHead: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 16, marginTop: 20, marginBottom: 10,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: COLORS.textDark,
    letterSpacing: -0.2,
  },
  sectionKn: {
    fontSize: 11, fontWeight: '700', color: COLORS.textBody, marginTop: 1,
    marginLeft: 6, marginBottom: 1,
  },
  countPill: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: RADII.pill,
  },
  countText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },

  // Category tiles
  catTile: {
    alignItems: 'center', marginRight: 12, width: 66,
  },
  catCircle: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  catCircleActive: {
    borderColor: COLORS.primary, borderWidth: 2,
  },
  catLabel: {
    fontSize: 10, fontWeight: '700', color: COLORS.textBody,
    marginTop: 6, textAlign: 'center',
  },
  catLabelActive: {
    color: COLORS.primaryDark, fontWeight: '800',
  },

  // Radius selector
  radiusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, marginTop: 12,
  },
  radiusLabel: {
    fontSize: 11, color: COLORS.textMuted, fontWeight: '600',
  },
  radiusChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill,
    backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border,
  },
  radiusChipActive: {
    backgroundColor: COLORS.primaryTint, borderColor: COLORS.primary,
  },
  radiusChipText: {
    fontSize: 10, fontWeight: '700', color: COLORS.textMuted,
  },
  radiusChipTextActive: { color: COLORS.primaryDark },

  // Empty state
  empty: {
    alignItems: 'center', padding: SPACING.xxl, marginHorizontal: 16,
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    borderWidth: 1, borderColor: COLORS.border, gap: 6, marginTop: 12,
  },
  emptyTitle:   { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 8 },
  emptyTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody },
  emptyMsg:     { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 17, marginTop: 6 },
  emptyBtn:     { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: RADII.pill, marginTop: 10 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  // Listing card — richer, more shopping-app-like
  card: {
    flexDirection: 'row', backgroundColor: COLORS.bgCard,
    borderRadius: RADII.lg, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden', ...SHADOWS.card,
  },
  // Image column — width is fixed, HEIGHT stretches to match the card body
  // (row flexbox default). Without this, cards taller than 100px (which most
  // now are after the APMC-rate + auto-fit lines were added) showed the image
  // in the top 100px with an empty primary-tint band underneath.
  cardEmojiWrap: {
    width: 110, minHeight: 110, backgroundColor: COLORS.primaryLightBg,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  cardPhoto: {
    ...StyleSheet.absoluteFillObject,   // fills whatever height the row gives it
  },
  savingsRibbon: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: COLORS.accentRed, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  savingsText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },
  photoBadge: {
    position: 'absolute', bottom: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
  },
  photoBadgeText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },

  cardBody: { flex: 1, padding: 12 },
  cardCrop:   { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  cardCropKn: { fontSize: 11, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },

  priceRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 6,
  },
  cardPrice:     { fontSize: 20, fontWeight: '800', color: COLORS.primaryDark },
  cardPriceUnit: { fontSize: 11, color: COLORS.textMuted },
  cardPriceStrike:{
    fontSize: 11, color: COLORS.textMuted, marginLeft: 4,
    textDecorationLine: 'line-through',
  },

  metaLine: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5,
  },
  metaLineText: {
    fontSize: 11, fontWeight: '500', color: COLORS.textMuted, flex: 1,
  },

  cardBottom: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: COLORS.borderLight,
  },
  cardMeta:  { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  cardTotal: { fontSize: 13, fontWeight: '800', color: COLORS.textDark },

  actionRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: COLORS.primaryTint, paddingVertical: 8,
    borderRadius: RADII.pill, flex: 1,
    borderWidth: 1, borderColor: COLORS.primaryLight,
  },
  callBtnText: { color: COLORS.primaryDark, fontWeight: '800', fontSize: 11 },
  offerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: COLORS.primary, paddingVertical: 8,
    borderRadius: RADII.pill, flex: 1,
  },
  offerBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },
  offerBtnFull: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, paddingVertical: 10,
    borderRadius: RADII.pill, marginTop: 8,
  },
});

// Notification sheet styles (kept separate from `s` for clarity)
const ns = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.bgApp,
    borderTopLeftRadius: RADII.xl, borderTopRightRadius: RADII.xl,
    paddingTop: 10, paddingBottom: 40,
    maxHeight: '88%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.borderDark,
            alignSelf: 'center', marginBottom: 8 },
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingBottom: 8,
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  sub:   { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  markAll: {
    backgroundColor: COLORS.primaryTint,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.primaryLight, marginTop: 4,
  },
  markAllText: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark },
  clearAll: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.accentRedBg,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#FCA5A5', marginTop: 4,
  },
  clearAllText: { fontSize: 11, fontWeight: '800', color: COLORS.accentRed },
  rowDelete: {
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    marginLeft: 4, alignSelf: 'flex-start',
  },
  empty: { padding: 40, alignItems: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  emptySub:   { marginTop: 4, fontSize: 11, color: COLORS.textMuted, textAlign: 'center' },
  bucket: {
    fontSize: 11, fontWeight: '800', color: COLORS.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: 14, marginBottom: 6, paddingLeft: 4,
  },
  row: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    padding: 12, marginBottom: 8, borderRadius: 12,
    backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border,
  },
  iconRing: { width: 36, height: 36, borderRadius: 18,
              alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textDark, flex: 1, lineHeight: 17 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563EB' },
  rowBody:   { fontSize: 11, color: COLORS.textBody, marginTop: 3, lineHeight: 15 },
  rowTime:   { fontSize: 10, color: COLORS.textMuted, marginTop: 4, fontWeight: '600' },
});
