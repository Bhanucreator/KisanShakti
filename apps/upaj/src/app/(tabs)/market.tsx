/**
 * Sell dashboard (Upaj / farmer side) — Hyperlocal Commerce.
 *
 * Redesigned around what the farmer actually needs to see at a glance:
 *   • Dashboard alert card at the top — "N pending offers, tap to review"
 *   • Two tabs: Active (waiting for buyers) and Orders (buyers reached out)
 *   • Rich listing cards with real crop PHOTOS, no ugly left green strip
 *   • New Listing modal now uploads a photo + auto-fills crop from the
 *     linked plot's newest growing cycle
 *
 * Sold trades still auto-post income to the linked plot's cycle in the
 * Business ledger — that hook lives in commerce_endpoints.py.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
  Alert, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import { useAuth } from '../../hooks/use-auth';
import {
  fetchMyListings, createCommerceListing, updateCommerceListing,
  deleteCommerceListing, uploadListingPhoto, appendListingPhoto,
  fetchOffersForListing, respondToOffer, fetchPriceBenchmark, fetchPriceSuggestion,
  type PriceSuggestion, fetchPlots,
  fetchCycles, resolvePhotoUrl,
  verifyDeliveryOtp,
  type CommerceListing, type CommerceOffer, type PriceBenchmark, type Plot,
  type CropCycle,
} from '../../lib/api';

// Lazy load so a stripped-down build doesn't blow up on the import
let ImagePicker: any = null;
try { ImagePicker = require('expo-image-picker'); } catch {}
let ImageManipulator: any = null;
try { ImageManipulator = require('expo-image-manipulator'); } catch {}

const CROP_EMOJI: Record<string, string> = {
  Tomato: '🍅', Onion: '🧅', Potato: '🥔', Ragi: '🌾', Maize: '🌽',
  Chili: '🌶️', Wheat: '🌾', Rice: '🌾', Cotton: '🌱', Sugarcane: '🎋',
  Groundnut: '🥜', Brinjal: '🍆', Carrot: '🥕', Cabbage: '🥬',
};

const fmtIN    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtPrice = (n: number) => `₹${n.toFixed(2)}`;
const parseServerTs = (iso: string): number => {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : iso + 'Z').getTime();
};
const ageLabel = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - parseServerTs(iso)) / 1000));
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.round(s/60)} min ago`;
  if (s < 86400) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)}d ago`;
};

type TabKey = 'active' | 'orders' | 'delivery' | 'past';

// ══════════════════════════════════════════════════════════════════════════════

export default function MarketScreen() {
  const [listings, setListings] = useState<CommerceListing[] | null>(null);
  const [pastListings, setPastListings] = useState<CommerceListing[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('active');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<CommerceListing | null>(null);

  const load = useCallback(async () => {
    // Load active + past in parallel. The Past tab is fed by the same
    // /listings endpoint with ?include_expired=true — the backend then
    // returns EXPIRED rows too, which we filter to just the expired ones.
    const [r, rWithExpired] = await Promise.all([
      fetchMyListings(),
      fetchMyListings({ includeExpired: true }),
    ]);
    setListings(r ?? []);
    // "Past" = the delta: rows present when include_expired is on but
    // NOT in the default set. That's exactly the EXPIRED rows.
    const activeIds = new Set((r ?? []).map(l => l.id));
    setPastListings((rWithExpired ?? []).filter(l => !activeIds.has(l.id)));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Reload every time the farmer navigates back to this tab so a listing
  // whose state changed elsewhere (buyer made a new offer, delivery got
  // marked complete on the OTHER side, etc.) is fresh on tab focus.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  // Three-way split. Rules:
  //   Delivery = listing status LOCKED (a buyer's offer accepted, crop moving)
  //              — this is where the OTP lives. Farmer CANNOT delete or mark
  //              sold from here — the buyer's trust depends on it.
  //   Orders   = pending offers waiting for farmer decision (accept/reject)
  //              — Sold/Delete DISABLED here too (buyer has already committed
  //              to purchase; ripping the listing away breaks trust).
  //   Active   = plain AVAILABLE listings, no buyer action yet
  //              — Sold/Delete ALLOWED here (farmer full control).
  const { active, orders, delivery, pendingCount } = useMemo(() => {
    const all = listings ?? [];
    const active:   CommerceListing[] = [];
    const orders:   CommerceListing[] = [];
    const delivery: CommerceListing[] = [];
    let pending = 0;
    for (const l of all) {
      // TERMINAL statuses first — always skip regardless of what stale
      // offer rows might be attached. Belt-and-braces because the backend
      // already excludes SOLD + EXPIRED by default, but if a rogue row
      // slips through (data-migration weirdness, dev seed leftovers, etc.),
      // we still keep the working tabs clean. Terminal rows land in the
      // Past tab via the include_expired=true fetch instead.
      if (l.status === 'SOLD' || l.status === 'EXPIRED') {
        continue;
      }
      if (l.status === 'LOCKED') {
        delivery.push(l);
      } else if (l.pending_offers_count > 0) {
        orders.push(l);
        pending += l.pending_offers_count;
      } else {
        // AVAILABLE with quantity remaining — includes partial-delivery
        // rebounds where a previous offer completed but qty_kg > 0.
        active.push(l);
      }
    }
    return { active, orders, delivery, pendingCount: pending };
  }, [listings]);

  // Past tab renders only the 5 most-recent past listings (already sorted
  // by created_at desc from the backend). Farmers don't need a scrollable
  // wall of last-year's expired ragi; the plot ledger in the Business tab
  // is the durable record. If a farmer wants full history, we can surface
  // an "Older" toggle later.
  const PAST_VISIBLE_LIMIT = 5;
  const pastTrimmed = (pastListings ?? []).slice(0, PAST_VISIBLE_LIMIT);
  const shown = tab === 'active'   ? active
              : tab === 'orders'   ? orders
              : tab === 'delivery' ? delivery
              : pastTrimmed;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
        // Farmers with many listings scroll a long list of cards — clip
        // off-screen ones so RN's paint pass stays cheap.
        removeClippedSubviews
      >
        {/* Header — clean, no stat cards */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Sell Your Crop</Text>
            <Text style={s.titleKn}>ನಿಮ್ಮ ಬೆಳೆ ಮಾರಿ</Text>
            <Text style={s.subtitle}>Direct to nearby buyers on Mandi</Text>
          </View>
          <View style={s.headerIcon}>
            <MaterialCommunityIcons name="storefront-outline" size={22} color={COLORS.primary} />
          </View>
        </View>

        {/* No in-app alert card here — that duplicates the Home bell. Real
            push notifications (system tray) are the primary channel; the
            Home tab's bell + feed is the secondary. Tabs stay clean. */}

        {/* Tab bar — 3 tabs. Counts only, no red urgency badges (those live
             on the Home bell). */}
        <View style={s.tabBar}>
          <TabButton
            active={tab === 'active'}
            label="Active"
            labelKn="ಸಕ್ರಿಯ"
            count={active.length}
            onPress={() => setTab('active')}
          />
          <TabButton
            active={tab === 'orders'}
            label="Orders"
            labelKn="ಆದೇಶಗಳು"
            count={orders.length}
            onPress={() => setTab('orders')}
          />
          <TabButton
            active={tab === 'delivery'}
            label="Delivery"
            labelKn="ವಿತರಣೆ"
            count={delivery.length}
            onPress={() => setTab('delivery')}
          />
          {/* Past = shelf-life-expired listings. Only rendered when the
              farmer actually has some — no point showing a 0 badge on
              day one. Read-only history view. */}
          {(pastListings?.length ?? 0) > 0 && (
            <TabButton
              active={tab === 'past'}
              label="Past"
              labelKn="ಹಿಂದಿನ"
              // Show the count of what's actually rendered (capped at 5) —
              // otherwise a farmer with 30 sold rows sees "Past 30" but
              // only 5 cards below, which is confusing.
              count={pastTrimmed.length}
              onPress={() => setTab('past')}
            />
          )}
        </View>

        {listings === null && <ActivityIndicator style={{ marginVertical: 24 }} color={COLORS.primary} />}
        {/* True-beginner card only. Once a farmer has EVER listed anything
            (active OR past), we stop showing "Sell your first crop" — even
            if their current active list is empty because everything sold.
            Otherwise the beginner card keeps popping up after each full
            sell-through, which is patronising to an experienced seller. */}
        {listings != null
          && listings.length === 0
          && (pastListings?.length ?? 0) === 0 && (
          <EmptyDashboard onCreate={() => setShowNew(true)} />
        )}
        {/* Empty-per-tab hint. Fires whenever the current tab has nothing
            to show AND we're NOT already showing the beginner card. */}
        {listings != null
          && shown.length === 0
          && !(listings.length === 0 && (pastListings?.length ?? 0) === 0) && (
          <View style={s.emptyMini}>
            <Text style={s.emptyMiniText}>
              {tab === 'active'
                ? 'No active listings · ಸಕ್ರಿಯ ಪಟ್ಟಿಗಳಿಲ್ಲ\nTap + to sell a crop'
                : tab === 'past'
                ? 'No past listings yet · ಹಿಂದಿನ ಪಟ್ಟಿಗಳಿಲ್ಲ\nCompleted sales and expired listings appear here'
                : "No orders yet · ಇನ್ನೂ ಆದೇಶಗಳಿಲ್ಲ\nBuyers haven't reached out"}
            </Text>
          </View>
        )}
        {shown.map(l => (
          <ListingCard key={l.id} listing={l} tab={tab} onPress={() => setSelected(l)} />
        ))}
      </ScrollView>

      <TouchableOpacity style={s.fab} onPress={() => setShowNew(true)} activeOpacity={0.85}>
        <Ionicons name="add" size={26} color="#FFF" />
      </TouchableOpacity>

      <NewListingModal
        visible={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => { setShowNew(false); load(); }}
      />
      <ListingDetailModal
        listing={selected}
        onClose={() => setSelected(null)}
        // Await the reload so that when the child closes itself after a
        // status transition (e.g. OTP verified → offer COMPLETED), the
        // underlying tab already reflects the new state. Previously this
        // was fire-and-forget, so the "Delivery" tab briefly still showed
        // the listing as IN_DELIVERY between close and the network round-trip
        // completing, which is exactly what farmers reported.
        onChanged={async () => { await load(); }}
      />
    </SafeAreaView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

function TabButton({
  active, label, labelKn, count, badge = false, onPress,
}: {
  active: boolean; label: string; labelKn: string; count: number;
  badge?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.tab, active && s.tabActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
        <View style={[s.tabCount, active && s.tabCountActive, badge && s.tabCountBadge]}>
          <Text style={[s.tabCountText, active && s.tabCountTextActive, badge && s.tabCountBadgeText]}>
            {count}
          </Text>
        </View>
      </View>
      <Text style={[s.tabLabelKn, active && s.tabLabelActive]}>{labelKn}</Text>
    </TouchableOpacity>
  );
}

function EmptyDashboard({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={s.emptyCard}>
      <View style={s.emptyIconRing}>
        <MaterialCommunityIcons name="basket-plus-outline" size={40} color={COLORS.primary} />
      </View>
      <Text style={s.emptyTitle}>Sell your first crop</Text>
      <Text style={s.emptyTitleKn}>ಮೊದಲ ಬೆಳೆ ಮಾರಿ</Text>
      <Text style={s.emptyMsg}>
        Add a photo, set a fair AGMARKNET-backed price, and nearby buyers on
        Mandi see your crop instantly. No middleman.
      </Text>
      <TouchableOpacity style={s.emptyCta} onPress={onCreate} activeOpacity={0.85}>
        <Ionicons name="add" size={16} color="#FFF" />
        <Text style={s.emptyCtaText}>List a crop · ಪಟ್ಟಿ ಮಾಡಿ</Text>
      </TouchableOpacity>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Listing card — photo left, info right, no ugly green strip
// ══════════════════════════════════════════════════════════════════════════════

function ListingCard({
  listing, tab, onPress,
}: { listing: CommerceListing; tab: TabKey; onPress: () => void }) {
  const emoji = CROP_EMOJI[listing.crop_name] || '🌱';
  const photoUrl = resolvePhotoUrl(listing.photo_url);

  const isSold      = listing.status === 'SOLD';
  const isAccepted  = listing.latest_offer?.status === 'ACCEPTED';
  const isPending   = listing.pending_offers_count > 0;

  const stateColor  = isSold ? '#059669'
                    : isAccepted ? '#059669'
                    : isPending ? '#D97706'
                    : COLORS.primary;
  const stateLabel  = isSold ? 'SOLD'
                    : isAccepted ? 'ACCEPTED'
                    : isPending ? `${listing.pending_offers_count} PENDING`
                    : 'AVAILABLE';

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.9}>
      {/* Fixed-size photo tile — square, always renders. No green strip. */}
      <View style={s.photoWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.photo} resizeMode="cover" />
        ) : (
          <View style={s.photoEmpty}><Text style={{ fontSize: 28 }}>{emoji}</Text></View>
        )}
        {tab === 'orders' && (
          <View style={[s.statePill, { backgroundColor: stateColor }]}>
            <Text style={s.statePillText}>{stateLabel}</Text>
          </View>
        )}
      </View>

      <View style={s.cardBody}>
        {/* Line 1: crop name + fair/unverified badge on the right */}
        <View style={s.cardTitleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardCrop} numberOfLines={1}>{listing.crop_name}</Text>
            {listing.crop_name_kn && (
              <Text style={s.cardCropKn} numberOfLines={1}>{listing.crop_name_kn}</Text>
            )}
          </View>
          {listing.fair_price && (
            <View style={s.fairBadge}>
              <Ionicons name="checkmark-circle" size={9} color="#166534" />
              <Text style={s.fairBadgeText}>Fair</Text>
            </View>
          )}
          {!listing.price_verified && (
            <View style={s.warnBadge}>
              <Text style={s.warnBadgeText}>?</Text>
            </View>
          )}
        </View>

        {/* Line 2: price + qty + village (auto-fetched from GPS) */}
        <Text style={s.cardMeta} numberOfLines={1}>
          {fmtPrice(listing.price_per_kg)}/kg · {listing.quantity_kg} kg
          {listing.village ? ` · ${listing.village}` : ''}
        </Text>

        {/* Line 3: total (colored) — always show, fills the empty half */}
        <Text style={s.cardTotal}>{fmtIN(listing.price_per_kg * listing.quantity_kg)}</Text>

        {/* Line 4: offer strip if any */}
        {listing.latest_offer && (
          <View style={s.offerStrip}>
            <Ionicons name="chatbubble-ellipses" size={10} color={COLORS.primary} />
            <Text style={s.offerStripText} numberOfLines={1}>
              {displayShopName(listing.latest_offer.buyer_shop_name, null)} · {fmtPrice(listing.latest_offer.offered_price_per_kg)}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// New Listing modal — photo picker + plot auto-fill
// ══════════════════════════════════════════════════════════════════════════════

function NewListingModal({
  visible, onClose, onCreated,
}: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const auth = useAuth();
  const [crop, setCrop]         = useState('');
  const [cropKn, setCropKn]     = useState('');
  const [qty, setQty]           = useState('');
  const [price, setPrice]       = useState('');
  const [plots, setPlots]       = useState<Plot[]>([]);
  const [plotId, setPlotId]     = useState<string | null>(null);
  const [plotHint, setPlotHint] = useState<string | null>(null);
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const MAX_PHOTOS = 5;
  const [benchmark, setBenchmark]     = useState<PriceBenchmark | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  // Auto-price-fit — set by /pricing/suggest when the farmer picks a crop.
  // Both `price` (auto-filled) and this snapshot travel together to the
  // create-listing call so the buyer can see which APMC quoted the number.
  const [suggestion, setSuggestion] = useState<PriceSuggestion | null>(null);
  const [priceEditedByUser, setPriceEditedByUser] = useState(false);
  const [gps, setGps]           = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const district = auth.profile?.location_name?.split(',')[0]?.trim() || 'Kolar';

  useEffect(() => {
    if (!visible) return;
    setCrop(''); setCropKn(''); setQty(''); setPrice('');
    setBenchmark(null); setSuggestion(null); setPriceEditedByUser(false);
    setPlotId(null); setPlotHint(null); setPhotoUris([]);
    fetchPlots().then(p => setPlots(p ?? []));
    if (auth.profile?.latitude && auth.profile?.longitude) {
      setGps({ lat: Number(auth.profile.latitude), lng: Number(auth.profile.longitude) });
    } else {
      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') { setGps({ lat: 13.1367, lng: 78.1325 }); return; }
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setGps({ lat: p.coords.latitude, lng: p.coords.longitude });
        } catch { setGps({ lat: 13.1367, lng: 78.1325 }); }
      })();
    }
  }, [visible, auth.profile]);

  // Auto-fill crop name when a plot is selected — pulls the newest GROWING
  // cycle on that plot. Farmer can override by typing.
  useEffect(() => {
    if (!plotId) { setPlotHint(null); return; }
    (async () => {
      const cycles = await fetchCycles(plotId);
      const growing = (cycles ?? [])
        .filter(c => c.status === 'GROWING')
        .sort((a, b) => new Date(b.sowing_date).getTime() - new Date(a.sowing_date).getTime());
      if (growing.length > 0) {
        const c = growing[0];
        // Only overwrite the crop name if the farmer hasn't typed one manually.
        setCrop(prev => prev.trim() ? prev : c.crop_name);
        setCropKn(prev => prev.trim() ? prev : (c.crop_name_kn ?? ''));
        const plot = plots.find(p => p.id === plotId);
        setPlotHint(`Auto-filled from ${plot?.label ?? 'plot'} · currently growing ${c.crop_name}`);
      } else {
        setPlotHint('This plot has no growing cycle — listing will not link to a cycle');
      }
    })();
  }, [plotId, plots]);

  // Debounced auto-price-fit — walks nearest APMCs, KMV then data.gov.in.
  // Auto-fills the price field ONLY when the farmer hasn't typed one manually
  // (priceEditedByUser guard). Keeps the old benchmark call as a fallback
  // guardrail — validate_price() on the backend still uses it.
  useEffect(() => {
    if (!crop.trim() || crop.trim().length < 3 || !gps) {
      setSuggestion(null); setBenchmark(null); return;
    }
    setBenchmarkLoading(true);
    const timer = setTimeout(async () => {
      const [sug, b] = await Promise.all([
        fetchPriceSuggestion({ crop: crop.trim(), lat: gps.lat, lon: gps.lng }),
        fetchPriceBenchmark(crop.trim(), district),
      ]);
      setBenchmarkLoading(false);
      setBenchmark(b);
      setSuggestion(sug);
      if (sug?.status === 'ok' && sug.suggested_price_kg != null && !priceEditedByUser) {
        setPrice(String(sug.suggested_price_kg));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [crop, district, gps]);

  const pickPhoto = async (source: 'camera' | 'gallery') => {
    if (!ImagePicker) {
      Alert.alert('Photo unavailable', 'This build does not include the image picker.');
      return;
    }
    try {
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant access to add a photo.');
        return;
      }
      const opts = { mediaTypes: ['images'] as const, quality: 0.9, allowsEditing: true, aspect: [4, 3] as [number, number] };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.[0]?.uri) return;

      // Compress before storing — smaller upload later
      let uri = result.assets[0].uri;
      if (ImageManipulator?.manipulateAsync) {
        try {
          const out = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1200 } }],
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
          );
          uri = out.uri;
        } catch {}
      }
      setPhotoUris(prev => prev.length >= MAX_PHOTOS ? prev : [...prev, uri]);
    } catch (e: any) {
      console.warn('[photo] pick failed:', e?.message);
      Alert.alert('Could not add photo', 'Try again.');
    }
  };

  const removePhotoAt = (i: number) =>
    setPhotoUris(prev => prev.filter((_, idx) => idx !== i));

  const floor   = benchmark ? +(benchmark.benchmark_price * 0.95).toFixed(2) : null;
  const ceiling = benchmark ? +(benchmark.benchmark_price * 1.05).toFixed(2) : null;
  const priceN  = parseFloat(price) || 0;
  const priceOk = benchmark == null || (floor != null && ceiling != null && priceN >= floor && priceN <= ceiling);

  const submit = async () => {
    if (inFlightRef.current) return;
    if (!crop.trim() || !qty.trim() || !price.trim() || !gps) return;
    if (photoUris.length === 0) {
      Alert.alert(
        'Photo required',
        'Please add at least one photo of your crop before listing. Buyers on Mandi need to see what they are buying.',
      );
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const okSug = suggestion?.status === 'ok' && suggestion.apmc ? suggestion : null;
      const r = await createCommerceListing({
        crop_name:    crop.trim(),
        crop_name_kn: cropKn.trim() || null,
        quantity_kg:  parseFloat(qty),
        price_per_kg: priceN,
        latitude:     gps.lat,
        longitude:    gps.lng,
        plot_id:      plotId,
        district,
        // Forward the auto-fit snapshot when we have one — buyer sees the
        // provenance on the listing card. Silently skipped if the farmer
        // typed the price without a suggestion.
        market_source_apmc:        okSug?.apmc?.name          ?? null,
        market_source_district:    okSug?.apmc?.district      ?? null,
        market_source_price_kg:    okSug?.suggested_price_kg  ?? null,
        market_source_distance_km: okSug?.apmc?.distance_km   ?? null,
        market_source_date:        okSug?.arrival_date        ?? null,
      });
      if (!r) {
        Alert.alert('Could not list', 'Backend rejected the listing. Check the fair price range and try again.');
        return;
      }
      // Upload photos after the listing exists (backend needs the ID first).
      // photoUris[0] is the primary (goes to the legacy single-photo endpoint
      // so photo_url stays populated for older Mandi builds). The rest are
      // appended one by one via the new multi-photo endpoint.
      const primary = await uploadListingPhoto(r.id, photoUris[0]);
      if (!primary) {
        Alert.alert(
          'Listing saved, primary photo failed',
          'Your listing was created but the primary photo did not upload. '
          + 'Open the listing again and add it from the detail screen.',
        );
      }
      let extraFailures = 0;
      for (const uri of photoUris.slice(1)) {
        const ok = await appendListingPhoto(r.id, uri);
        if (!ok) extraFailures += 1;
      }
      if (extraFailures > 0) {
        Alert.alert(
          'Some photos did not upload',
          `${extraFailures} extra photo(s) failed. You can add them later from the listing.`,
        );
      }
      onCreated();
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={s.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <TouchableOpacity style={s.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={[s.sheet, { maxHeight: '92%' }]}>
          <View style={s.sheetHandle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={s.sheetTitle}>New Listing · ಹೊಸ ಪಟ್ಟಿ</Text>

            {/* Photos — REQUIRED. Buyers don't take blind bids. Up to 5.
                Thumb strip shows what's added, first is the primary shown
                on the card. Camera / Gallery buttons hide when at max. */}
            <Text style={s.label}>
              Photos · required <Text style={{ color: COLORS.accentRed }}>*</Text>
              <Text style={{ color: COLORS.textMuted, fontWeight: '400' }}>  {photoUris.length}/{MAX_PHOTOS}</Text>
            </Text>
            {photoUris.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {photoUris.map((uri, i) => (
                  <View key={uri + i} style={s.thumbTile}>
                    <Image source={{ uri }} style={s.thumbImg} />
                    {i === 0 && (
                      <View style={s.primaryBadge}>
                        <Text style={s.primaryBadgeText}>PRIMARY</Text>
                      </View>
                    )}
                    <TouchableOpacity
                      style={s.thumbRemove}
                      onPress={() => removePhotoAt(i)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="close" size={12} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            {photoUris.length < MAX_PHOTOS && (
              <View style={s.photoPickRow}>
                <TouchableOpacity style={s.photoPickBtn} onPress={() => pickPhoto('camera')} activeOpacity={0.85}>
                  <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
                  <Text style={s.photoPickText}>
                    {photoUris.length === 0 ? 'Camera' : 'Add from Camera'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.photoPickBtn} onPress={() => pickPhoto('gallery')} activeOpacity={0.85}>
                  <Ionicons name="images-outline" size={18} color={COLORS.primary} />
                  <Text style={s.photoPickText}>
                    {photoUris.length === 0 ? 'Gallery' : 'Add from Gallery'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Plot picker first (auto-fills crop below) */}
            {plots.length > 0 && (
              <>
                <Text style={s.label}>From plot (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <TouchableOpacity
                    style={[s.plotChip, plotId === null && s.plotChipActive]}
                    onPress={() => { setPlotId(null); setPlotHint(null); }}
                  >
                    <Text style={[s.plotChipText, plotId === null && s.plotChipTextActive]}>Not a plot crop</Text>
                  </TouchableOpacity>
                  {plots.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[s.plotChip, plotId === p.id && s.plotChipActive]}
                      onPress={() => setPlotId(p.id)}
                    >
                      <Text style={[s.plotChipText, plotId === p.id && s.plotChipTextActive]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {plotHint && (
                  <View style={s.plotHintBox}>
                    <Ionicons name="sparkles" size={12} color={COLORS.primary} />
                    <Text style={s.plotHintText}>{plotHint}</Text>
                  </View>
                )}
              </>
            )}

            <Text style={s.label}>Crop name</Text>
            <TextInput style={s.input} value={crop} onChangeText={setCrop}
              placeholder="e.g. Tomato" placeholderTextColor={COLORS.textMuted} />

            <Text style={s.label}>Kannada name (optional)</Text>
            <TextInput style={s.input} value={cropKn} onChangeText={setCropKn}
              placeholder="ಟೊಮೇಟೊ" placeholderTextColor={COLORS.textMuted} />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Quantity (kg)</Text>
                <TextInput style={s.input} value={qty} onChangeText={setQty}
                  keyboardType="decimal-pad" placeholder="50" placeholderTextColor={COLORS.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Price ₹/kg</Text>
                <TextInput
                  style={[s.input, !priceOk && s.inputError]}
                  value={price}
                  onChangeText={(v) => { setPrice(v); setPriceEditedByUser(true); }}
                  keyboardType="decimal-pad" placeholder="20" placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>

            {/* Single unified price hint. Suggestion is the primary source
                (KMV / data.gov.in nearest-APMC modal). The AGMARKNET benchmark
                is a secondary guardrail — surfaced ONLY when the farmer's
                typed price falls outside its ±5% fair range. Removes the old
                "No AGMARKNET price / Unverified" noise that used to appear
                alongside a perfectly good KMV suggestion. */}
            <View style={s.hintBox}>
              {benchmarkLoading && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={s.hintText}>Finding nearest APMC price…</Text>
                </View>
              )}

              {!benchmarkLoading && suggestion?.status === 'ok' && suggestion.apmc && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                  <Ionicons name="location" size={14} color={COLORS.primary} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.hintText, { fontWeight: '700' }]}>
                      Fitted from {suggestion.apmc.name} APMC · {Math.round(suggestion.apmc.distance_km)} km
                    </Text>
                    <Text style={s.hintTextKn}>
                      {suggestion.source === 'kmv' ? 'KMV' : 'AGMARKNET'} modal
                      {suggestion.arrival_date ? ` · ${suggestion.arrival_date}` : ''}
                      {suggestion.min_price_kg != null && suggestion.max_price_kg != null
                        ? ` · range ₹${suggestion.min_price_kg}–₹${suggestion.max_price_kg}/kg`
                        : ''}
                    </Text>
                    {benchmark && !priceOk && (
                      <Text style={s.hintTextError}>
                        Your price is outside the fair range ({fmtPrice(floor!)}–{fmtPrice(ceiling!)}/kg).
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {!benchmarkLoading && suggestion?.status === 'unavailable' && crop.trim().length >= 3 && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                  <Ionicons name="alert-circle-outline" size={14} color={COLORS.accentAmber} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.hintText, { fontWeight: '700' }]}>
                      No nearby APMC posted {crop.trim()} recently
                    </Text>
                    <Text style={s.hintTextKn}>
                      Enter your best price — the listing will still save.
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[
                s.submitBtn,
                (submitting || !priceOk || !crop.trim() || !qty.trim() || !price.trim() || !gps || photoUris.length === 0) && s.submitDisabled,
              ]}
              onPress={submit}
              disabled={submitting || !priceOk || !crop.trim() || !qty.trim() || !price.trim() || !gps || photoUris.length === 0}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color="#FFF" />
                : <Text style={s.submitText}>Create listing · ಪಟ್ಟಿ ರಚಿಸಿ</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Listing detail modal — offers + accept/reject + mark sold + delete
// ══════════════════════════════════════════════════════════════════════════════

function ListingDetailModal({
  listing, onClose, onChanged,
}: { listing: CommerceListing | null; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [offers, setOffers] = useState<CommerceOffer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!listing) { setOffers(null); return; }
    fetchOffersForListing(listing.id).then(o => setOffers(o ?? []));
  }, [listing]);

  const respond = async (offerId: string, action: 'ACCEPT' | 'REJECT') => {
    setBusy(offerId);
    const r = await respondToOffer(offerId, action);
    setBusy(null);
    if (r) {
      onChanged();
      if (listing) fetchOffersForListing(listing.id).then(o => setOffers(o ?? []));
      if (action === 'ACCEPT') {
        Alert.alert(
          'Offer accepted — go deliver',
          `Deliver the crop to the buyer, then ask them for their 6-digit OTP `
          + `and enter it in the Delivery tab. Income posts to your plot only `
          + `after you verify the OTP.`,
        );
      }
    }
  };

  const markSold = async () => {
    if (!listing) return;
    setBusy('SOLD');
    const r = await updateCommerceListing(listing.id, { status: 'SOLD' });
    setBusy(null);
    if (r) {
      // Mark-sold is a manual bookkeeping shortcut (crop sold off-app, not
      // through a Mandi buyer). Ledger updates via updateCommerceListing's
      // own status hook on the backend. No OTP flow here.
      onChanged(); onClose();
    }
  };

  // Pick + upload a photo directly against the existing listing. Uses the
  // same pipeline as NewListingModal so a farmer whose photo failed at
  // creation-time can retry, and any existing listing can gain/change art.
  const changePhoto = async () => {
    if (!listing || !ImagePicker) {
      Alert.alert('Photo unavailable', 'This build does not include the image picker.');
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant photo access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const, quality: 0.9, allowsEditing: true, aspect: [4, 3] as [number, number],
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      let uri = result.assets[0].uri;
      if (ImageManipulator?.manipulateAsync) {
        try {
          const out = await ImageManipulator.manipulateAsync(
            uri, [{ resize: { width: 1200 } }],
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
          );
          uri = out.uri;
        } catch {}
      }
      setBusy('PHOTO');
      const uploaded = await uploadListingPhoto(listing.id, uri);
      setBusy(null);
      if (uploaded) {
        onChanged();
        Alert.alert('Photo updated');
      } else {
        Alert.alert('Upload failed', 'Check the backend logs for details.');
      }
    } catch (e: any) {
      setBusy(null);
      Alert.alert('Could not add photo', e?.message ?? 'Try again.');
    }
  };

  const removeListing = () => {
    if (!listing) return;
    const hasPendingOffers = (offers ?? []).some(o => o.status === 'PENDING');
    Alert.alert(
      hasPendingOffers ? 'Delete listing with pending offers?' : 'Delete this listing?',
      hasPendingOffers
        ? 'Buyers have pending offers on this listing. They will all be removed too.'
        : 'This will permanently remove the listing.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy('DELETE');
          const r = await deleteCommerceListing(listing.id);
          setBusy(null);
          if (r) { onChanged(); onClose(); }
          else Alert.alert('Could not delete', 'Try again in a moment.');
        }},
      ],
    );
  };

  const pending  = (offers ?? []).filter(o => o.status === 'PENDING');
  const answered = (offers ?? []).filter(o => o.status !== 'PENDING');
  const photoUrl = resolvePhotoUrl(listing?.photo_url);

  return (
    <Modal visible={!!listing} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.modalOverlay}>
        <TouchableOpacity style={s.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={[s.sheet, { maxHeight: '92%' }]}>
          <View style={s.sheetHandle} />
          <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
            {listing && (
              <>
                {photoUrl ? (
                  <View style={{ position: 'relative' }}>
                    <Image source={{ uri: photoUrl }} style={s.detailPhoto} resizeMode="cover" />
                    <TouchableOpacity
                      style={s.detailPhotoChangeBtn}
                      onPress={changePhoto}
                      disabled={busy != null}
                      activeOpacity={0.85}
                    >
                      {busy === 'PHOTO'
                        ? <ActivityIndicator color="#FFF" size="small" />
                        : (
                          <>
                            <Ionicons name="camera" size={13} color="#FFF" />
                            <Text style={s.detailPhotoChangeText}>Change</Text>
                          </>
                        )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={s.addPhotoBtn}
                    onPress={changePhoto}
                    disabled={busy != null}
                    activeOpacity={0.85}
                  >
                    {busy === 'PHOTO'
                      ? <ActivityIndicator color={COLORS.primaryDark} />
                      : (
                        <>
                          <Ionicons name="camera-outline" size={20} color={COLORS.primaryDark} />
                          <Text style={s.addPhotoBtnText}>Add crop photo · ಫೋಟೋ ಸೇರಿಸಿ</Text>
                        </>
                      )}
                  </TouchableOpacity>
                )}
                <Text style={s.sheetTitle}>{listing.crop_name}</Text>
                {listing.crop_name_kn && <Text style={s.sheetSubtitle}>{listing.crop_name_kn}</Text>}

                <View style={s.detailRow}>
                  <DetailStat label="Qty" value={`${listing.quantity_kg} kg`} />
                  <DetailStat label="Price" value={`${fmtPrice(listing.price_per_kg)}/kg`} />
                  <DetailStat label="Total" value={fmtIN(listing.price_per_kg * listing.quantity_kg)} />
                </View>

                {listing.benchmark_price != null && (
                  <View style={s.benchmarkStrip}>
                    <Ionicons name="pricetag-outline" size={13} color={COLORS.primary} />
                    <Text style={s.benchmarkText}>
                      AGMARKNET today: {fmtPrice(listing.benchmark_price)}/kg
                    </Text>
                  </View>
                )}

                {/* Action buttons — TRUST-SAFE. Rules:
                     • AVAILABLE + no pending offers → farmer owns full control
                       (Mark Sold + Delete)
                     • AVAILABLE + has pending offers → NO destructive buttons
                       (buyer trust — they've committed intent)
                     • LOCKED (in-delivery) → OTP card + Cancel/Manual-complete
                     • SOLD → read-only history */}
                {(() => {
                  const inDelivery = (offers ?? []).find(o => o.status === 'IN_DELIVERY');
                  const hasPending = pending.length > 0;

                  if (inDelivery) {
                    return (
                      <DeliveryActions
                        offer={inDelivery}
                        busy={busy}
                        onVerify={async (otp: string) => {
                          setBusy('VERIFY');
                          const r = await verifyDeliveryOtp(inDelivery.id, otp);
                          if (r) {
                            // AWAIT the reload before closing — otherwise
                            // the alert fires + modal closes while the parent
                            // still shows stale IN_DELIVERY tab. Farmer sees
                            // "delivery in progress" for ~1 round-trip until
                            // the refetch lands. Awaiting keeps the busy
                            // spinner visible for ~200 ms extra but the tab
                            // is up-to-date the moment the modal dismisses.
                            await onChanged();
                            setBusy(null);
                            Alert.alert(
                              'Sale complete',
                              'OTP verified. Income posted to this plot\'s cycle in the Business tab.',
                            );
                            onClose();
                          } else {
                            setBusy(null);
                            Alert.alert(
                              'Wrong OTP',
                              'Ask the buyer to read it again from their app.',
                            );
                          }
                        }}
                      />
                    );
                  }

                  if (listing.status === 'AVAILABLE' && !hasPending) {
                    // Full farmer control — no buyer has committed yet
                    return (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          style={[s.markSoldBtn, { flex: 1 }, busy != null && s.submitDisabled]}
                          onPress={markSold}
                          disabled={busy != null}
                          activeOpacity={0.85}
                        >
                          {busy === 'SOLD'
                            ? <ActivityIndicator color="#FFF" />
                            : (
                              <>
                                <MaterialCommunityIcons name="check-decagram" size={16} color="#FFF" />
                                <Text style={s.markSoldText}>Mark sold · ಮಾರಿದೆ</Text>
                              </>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[s.deleteBtn, busy != null && s.submitDisabled]}
                          onPress={removeListing}
                          disabled={busy != null}
                          activeOpacity={0.85}
                        >
                          {busy === 'DELETE'
                            ? <ActivityIndicator color={COLORS.accentRed} />
                            : <Ionicons name="trash-outline" size={16} color={COLORS.accentRed} />}
                        </TouchableOpacity>
                      </View>
                    );
                  }

                  if (hasPending) {
                    return (
                      <View style={s.trustBanner}>
                        <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
                        <Text style={s.trustBannerText}>
                          Buyers are interested. Accept or reject their offers below — you can't
                          delete or mark sold while they wait.
                        </Text>
                      </View>
                    );
                  }

                  // SOLD or other terminal state — read only
                  return null;
                })()}

                <Text style={[s.sectionTitle, { marginTop: SPACING.lg }]}>Offers received</Text>
                <Text style={s.sectionTitleKn}>ಪಡೆದ ಬಿಡ್‌ಗಳು</Text>

                {offers == null && <ActivityIndicator style={{ marginVertical: 16 }} color={COLORS.primary} />}
                {offers && offers.length === 0 && (
                  <View style={s.emptyMini}>
                    <Text style={s.emptyMiniText}>No offers yet · ಇನ್ನೂ ಯಾವ ಬಿಡ್ ಇಲ್ಲ</Text>
                  </View>
                )}
                {pending.map(o => (
                  <OfferRow key={o.id} offer={o} busy={busy === o.id}
                    onAccept={() => respond(o.id, 'ACCEPT')}
                    onReject={() => respond(o.id, 'REJECT')} />
                ))}
                {answered.length > 0 && (
                  <>
                    <Text style={s.answeredHeader}>Answered</Text>
                    {answered.map(o => (
                      <OfferRow key={o.id} offer={o} />
                    ))}
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailStat}>
      <Text style={s.detailStatLabel}>{label}</Text>
      <Text style={s.detailStatValue}>{value}</Text>
    </View>
  );
}

/**
 * DeliveryActions — shown when a listing is in-delivery (LOCKED).
 *
 * The BUYER holds the OTP (they see it on their app). Farmer's job:
 * deliver crop → ask buyer for OTP → type it here → verify.
 */
function DeliveryActions({
  offer, busy, onVerify,
}: {
  offer: CommerceOffer; busy: string | null;
  onVerify: (otp: string) => void;
}) {
  const [otp, setOtp] = useState('');

  const submit = () => {
    if (otp.length !== 6) return;
    onVerify(otp);
  };

  return (
    <View>
      <View style={s.otpCard}>
        <Ionicons name="keypad-outline" size={24} color="#FFF" />
        <Text style={s.otpLabel}>Ask buyer for their OTP</Text>
        <Text style={s.otpHelp}>
          The buyer holds a 6-digit OTP. On physical delivery, ask them to
          read it out and enter it below. Income posts to your plot only
          after this OTP matches.
        </Text>
        <TextInput
          style={s.otpInput}
          value={otp}
          onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="000000"
          placeholderTextColor="rgba(255,255,255,0.35)"
          maxLength={6}
        />
        <TouchableOpacity
          style={[s.otpVerifyBtn, (busy != null || otp.length !== 6) && s.submitDisabled]}
          onPress={submit}
          disabled={busy != null || otp.length !== 6}
          activeOpacity={0.85}
        >
          {busy === 'VERIFY'
            ? <ActivityIndicator color={COLORS.primaryDark} />
            : (
              <>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.primaryDark} />
                <Text style={s.otpVerifyText}>Verify & complete sale</Text>
              </>
            )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Mask "+919845632145" → "98XXX XX145". Keeps identity check possible
// without exposing the number to a farmer who hasn't yet accepted the bid.
function maskPhone(p: string | null): string {
  if (!p) return '';
  const digits = p.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return '';
  return `${digits.slice(0, 2)}XXX XX${digits.slice(-3)}`;
}

// A legacy signup path saved shop_name = phone_number for buyers who never
// entered a business name. Detect that (and empty/blank) so the UI shows a
// clean placeholder instead of the phone in the shop-name slot.
function displayShopName(shopName: string | null, phone: string | null): string {
  const s = (shopName || '').trim();
  if (!s) return 'Buyer';
  const shopDigits = s.replace(/\D/g, '');
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (shopDigits.length >= 10 && (shopDigits === phoneDigits || /^\+?\d+$/.test(s))) {
    return 'Buyer';
  }
  return s;
}

function OfferRow({
  offer, busy = false, onAccept, onReject,
}: { offer: CommerceOffer; busy?: boolean; onAccept?: () => void; onReject?: () => void }) {
  const total = offer.offered_price_per_kg * offer.quantity_kg;
  const statusColor =
    offer.status === 'ACCEPTED' ? '#059669'
      : offer.status === 'IN_DELIVERY' ? '#1D4ED8'
      : offer.status === 'REJECTED' ? COLORS.accentRed
      : offer.status === 'PENDING' ? '#D97706'
      : COLORS.textMuted;
  // Farmer sees the real phone number only after they commit to the trade.
  // PENDING shows a masked "98XXX XX145" — enough to recognise a repeat
  // buyer without handing out contact info to every bidder.
  const canCall =
    offer.status === 'ACCEPTED' ||
    offer.status === 'IN_DELIVERY' ||
    offer.status === 'COMPLETED';
  const phoneToShow = canCall
    ? (offer.buyer_phone || '')
    : maskPhone(offer.buyer_phone);
  return (
    <View style={s.offerCard}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={s.offerBuyer}>{displayShopName(offer.buyer_shop_name, offer.buyer_phone)}</Text>
          {phoneToShow ? (
            <Text style={s.offerPhone}>
              <Ionicons name="call-outline" size={10} color={COLORS.textMuted} />
              {' '}{phoneToShow}
            </Text>
          ) : null}
          <Text style={s.offerMeta}>
            {offer.quantity_kg} kg × {fmtPrice(offer.offered_price_per_kg)}/kg
          </Text>
          <Text style={s.offerTotal}>{fmtIN(total)}</Text>
        </View>
        <Text style={[s.offerStatus, { color: statusColor }]}>{offer.status}</Text>
      </View>
      {offer.status === 'PENDING' && onAccept && onReject && (
        <View style={s.offerActions}>
          <TouchableOpacity style={s.rejectBtn} onPress={onReject} disabled={busy} activeOpacity={0.85}>
            <Text style={s.rejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.acceptBtn} onPress={onAccept} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#FFF" size="small" />
              : <Text style={s.acceptText}>Accept</Text>}
          </TouchableOpacity>
        </View>
      )}
      {canCall && offer.buyer_phone && (
        <TouchableOpacity
          style={s.callBtn}
          onPress={() => Linking.openURL(`tel:${offer.buyer_phone}`)}
          activeOpacity={0.85}
        >
          <Ionicons name="call" size={13} color="#FFF" />
          <Text style={s.callText}>Call buyer · ಕರೆ ಮಾಡಿ</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 140 },

  header:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: SPACING.md },
  title:    { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  titleKn:  { fontSize: 14, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },
  headerIcon:{
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primaryLightBg,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primaryTint,
  },

  // Alert card
  alertCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#DCFCE7', borderRadius: RADII.lg,
    padding: SPACING.md, marginBottom: SPACING.md,
    borderWidth: 1, borderColor: '#86EFAC',
  },
  alertBell: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  alertBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.accentRed,
    paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#DCFCE7',
  },
  alertBadgeText: { fontSize: 10, fontWeight: '800', color: '#FFF' },
  alertTitle: { fontSize: 13, fontWeight: '800', color: COLORS.primaryDark },
  alertSub:   { fontSize: 11, color: COLORS.textBody, marginTop: 2 },

  // Tab bar
  tabBar: {
    flexDirection: 'row', gap: 8,
    backgroundColor: COLORS.bgSubtle, borderRadius: RADII.lg,
    padding: 4, marginBottom: SPACING.md,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: RADII.md,
  },
  tabActive: { backgroundColor: COLORS.bgCard, ...SHADOWS.card },
  tabLabel:  { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  tabLabelActive: { color: COLORS.primaryDark },
  tabLabelKn: { fontSize: 10, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  tabCount:  {
    minWidth: 20, height: 18, borderRadius: 9, backgroundColor: COLORS.bgSubtle,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabCountActive: { backgroundColor: COLORS.primaryLightBg, borderColor: COLORS.primaryTint },
  tabCountBadge:  { backgroundColor: COLORS.accentRed, borderColor: COLORS.accentRed },
  tabCountText:   { fontSize: 10, fontWeight: '800', color: COLORS.textMuted },
  tabCountTextActive: { color: COLORS.primaryDark },
  tabCountBadgeText:  { color: '#FFF' },

  // Compact card — square photo left, 3 lines of info right. No green strip.
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: RADII.md, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden', ...SHADOWS.card,
  },
  // 96×96 photo tile — matches the taller card body so no whitespace on
  // the right. Fixed dimensions (not %) so the Image always renders.
  photoWrap: { width: 96, height: 96, position: 'relative' },
  photo:     { width: 96, height: 96 },
  photoEmpty:{
    width: 96, height: 96, backgroundColor: COLORS.primaryLightBg,
    alignItems: 'center', justifyContent: 'center',
  },
  statePill: {
    position: 'absolute', top: 4, left: 4,
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 3,
  },
  statePillText: { fontSize: 8, fontWeight: '800', color: '#FFF', letterSpacing: 0.3 },
  cardBody:   { flex: 1, paddingHorizontal: 12, paddingVertical: 8 },
  cardTitleRow:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardCrop:   { flex: 1, fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  cardCropKn: { fontSize: 11, fontWeight: '700', color: COLORS.textBody },
  cardMeta:   { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  cardTotal:  { fontSize: 14, fontWeight: '800', color: COLORS.primary, marginTop: 2 },
  offerStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3,
  },
  offerStripText: { fontSize: 10, color: COLORS.primaryDark, fontWeight: '700', flex: 1 },
  fairBadge:    { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#DCFCE7',
                  paddingHorizontal: 5, paddingVertical: 1, borderRadius: RADII.pill, borderWidth: 1, borderColor: '#BBF7D0' },
  fairBadgeText:{ fontSize: 9, fontWeight: '700', color: '#166534' },
  warnBadge:    { width: 16, height: 16, backgroundColor: '#FEF3C7', borderRadius: 8,
                  alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FDE68A' },
  warnBadgeText:{ fontSize: 9, fontWeight: '800', color: '#B45309' },

  fab: { position: 'absolute', right: 20, bottom: 100, width: 56, height: 56, borderRadius: 28,
         backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', ...SHADOWS.popover },

  // Empty states
  emptyCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.xl, padding: SPACING.xl,
               alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  emptyIconRing: { width: 78, height: 78, borderRadius: 39, backgroundColor: COLORS.primaryLightBg,
                   alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle:   { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  emptyTitleKn: { fontSize: 14, fontWeight: '700', color: COLORS.textBody },
  emptyMsg:     { fontSize: 12, color: COLORS.textBody, textAlign: 'center', lineHeight: 17, marginTop: 6 },
  emptyCta:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary,
                  paddingHorizontal: 20, paddingVertical: 12, borderRadius: RADII.pill, marginTop: 12 },
  emptyCtaText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  emptyMini:    { padding: SPACING.md, backgroundColor: COLORS.bgCard, borderRadius: RADII.md,
                  borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', marginBottom: 8 },
  emptyMiniText:{ fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  // Modal / sheet
  modalOverlay:  { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill as object, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: COLORS.bgCard, borderTopLeftRadius: RADII.xl, borderTopRightRadius: RADII.xl,
           padding: SPACING.xl, paddingBottom: 40, ...SHADOWS.popover },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.borderDark,
                 alignSelf: 'center', marginBottom: SPACING.md },
  sheetTitle:   { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  sheetSubtitle:{ fontSize: 13, color: COLORS.textBody, marginBottom: SPACING.md },

  label: { fontSize: 12, fontWeight: '700', color: COLORS.textDark, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
           borderRadius: RADII.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: COLORS.textDark },
  inputError: { borderColor: COLORS.accentRed },

  // Photo picker
  photoPickRow: { flexDirection: 'row', gap: 10 },
  photoPickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primaryLightBg, borderWidth: 1, borderColor: COLORS.primaryTint,
    borderRadius: RADII.md, paddingVertical: 14,
  },
  photoPickText: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark },
  photoPreviewWrap: { position: 'relative', marginBottom: 4 },
  photoPreview: { width: '100%', height: 160, borderRadius: RADII.md, backgroundColor: COLORS.bgSubtle },
  photoRemove: {
    position: 'absolute', top: 8, right: 8,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  // Thumb strip for multi-photo picker
  thumbTile: {
    position: 'relative',
    width: 76, height: 76, marginRight: 8,
    borderRadius: RADII.md, overflow: 'hidden',
    backgroundColor: COLORS.bgSubtle,
    borderWidth: 1, borderColor: COLORS.border,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3,
  },
  primaryBadgeText: { color: '#FFF', fontSize: 8, fontWeight: '800', letterSpacing: 0.3 },

  hintBox: { backgroundColor: COLORS.primaryLightBg, borderRadius: RADII.md,
             padding: SPACING.md, marginTop: 10, borderWidth: 1, borderColor: COLORS.primaryTint },
  hintText:    { fontSize: 12, color: COLORS.textDark, lineHeight: 16 },
  hintTextKn:  { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  hintTextError:{ fontSize: 11, color: COLORS.accentRed, fontWeight: '700', marginTop: 4 },

  plotChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill, backgroundColor: COLORS.bgSubtle,
              borderWidth: 1, borderColor: COLORS.border, marginRight: 6 },
  plotChipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  plotChipText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  plotChipTextActive: { color: '#FFF' },
  plotHintBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#DCFCE7', padding: 8, borderRadius: RADII.md,
    borderWidth: 1, borderColor: '#BBF7D0', marginBottom: 4,
  },
  plotHintText: { flex: 1, fontSize: 11, color: COLORS.primaryDark, fontWeight: '600', lineHeight: 14 },

  submitBtn: { backgroundColor: COLORS.primaryDark, borderRadius: RADII.pill, paddingVertical: 14,
               alignItems: 'center', marginTop: SPACING.lg, ...SHADOWS.card },
  submitText:{ fontSize: 15, fontWeight: '800', color: '#FFF' },
  submitDisabled: { opacity: 0.5 },

  detailPhoto: { width: '100%', height: 200, borderRadius: RADII.lg, marginBottom: SPACING.md },
  detailPhotoChangeBtn: {
    position: 'absolute', bottom: 20, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADII.pill,
  },
  detailPhotoChangeText: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  addPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primaryLightBg,
    paddingVertical: 16, borderRadius: RADII.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.primaryTint,
    marginBottom: SPACING.md,
  },
  addPhotoBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark },
  detailRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.md, marginBottom: SPACING.md },
  detailStat: { flex: 1, backgroundColor: COLORS.bgSubtle, borderRadius: RADII.md, padding: SPACING.md, alignItems: 'flex-start' },
  detailStatLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '700' },
  detailStatValue: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 4 },

  benchmarkStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primaryLightBg,
                    padding: 10, borderRadius: RADII.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.primaryTint },
  benchmarkText:  { fontSize: 12, fontWeight: '700', color: COLORS.primaryDark },

  markSoldBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                 backgroundColor: '#059669', paddingVertical: 12, borderRadius: RADII.pill },
  markSoldText:{ fontSize: 14, fontWeight: '800', color: '#FFF' },
  deleteBtn:   { width: 46, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: '#FEE2E2', paddingVertical: 12, borderRadius: RADII.pill,
                 borderWidth: 1, borderColor: '#FCA5A5' },
  deleteBtnFull:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: '#FEE2E2', paddingVertical: 10, borderRadius: RADII.pill,
                  borderWidth: 1, borderColor: '#FCA5A5' },
  deleteBtnText:{ fontSize: 12, fontWeight: '800', color: COLORS.accentRed },

  sectionTitle:  { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  sectionTitleKn:{ fontSize: 12, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },

  offerCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.md, padding: SPACING.md,
               borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  offerBuyer: { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  offerPhone: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, letterSpacing: 0.3 },
  offerMeta:  { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  offerTotal: { fontSize: 16, fontWeight: '800', color: COLORS.primary, marginTop: 4 },
  offerStatus:{ fontSize: 10, fontWeight: '800' },
  offerActions:{ flexDirection: 'row', gap: 8, marginTop: 10 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 10, paddingVertical: 9, borderRadius: RADII.pill,
    backgroundColor: COLORS.primary,
  },
  callText: { fontSize: 12, fontWeight: '800', color: '#FFF', letterSpacing: 0.3 },
  acceptBtn:  { flex: 1, backgroundColor: COLORS.primary, paddingVertical: 10, borderRadius: RADII.pill, alignItems: 'center' },
  acceptText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  rejectBtn:  { flex: 1, backgroundColor: COLORS.bgSubtle, paddingVertical: 10, borderRadius: RADII.pill, alignItems: 'center',
                borderWidth: 1, borderColor: COLORS.border },
  rejectText: { color: COLORS.textDark, fontWeight: '700', fontSize: 13 },
  answeredHeader: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginTop: 8, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Trust banner shown when pending offers block destructive actions
  trustBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    padding: SPACING.md, borderRadius: RADII.md,
    backgroundColor: COLORS.primaryLightBg,
    borderWidth: 1, borderColor: COLORS.primaryTint,
  },
  trustBannerText: { flex: 1, fontSize: 11, color: COLORS.primaryDark, lineHeight: 15, fontWeight: '600' },

  // OTP entry card during delivery — farmer types what the buyer reads out.
  otpCard: {
    backgroundColor: COLORS.primaryDark, borderRadius: RADII.lg,
    padding: SPACING.lg, alignItems: 'center',
  },
  otpLabel:  { fontSize: 14, fontWeight: '800', color: '#FFF',
               letterSpacing: 0.5, marginTop: 8 },
  otpHelp:   { fontSize: 11, color: 'rgba(255,255,255,0.8)',
               textAlign: 'center', marginTop: 6, lineHeight: 15,
               paddingHorizontal: 4 },
  otpInput:  { width: '100%', backgroundColor: 'rgba(255,255,255,0.12)',
               borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
               borderRadius: RADII.md, paddingVertical: 16,
               fontSize: 30, fontWeight: '800', color: '#FFF',
               letterSpacing: 14, textAlign: 'center', marginTop: 14 },
  otpVerifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: '100%', backgroundColor: '#FFF', borderRadius: RADII.pill,
    paddingVertical: 12, marginTop: 12,
  },
  otpVerifyText: { fontSize: 14, fontWeight: '800', color: COLORS.primaryDark },
});
