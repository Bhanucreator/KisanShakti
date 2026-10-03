/**
 * Listing detail screen — Mandi buyer app.
 *
 * Full listing info, benchmark price context, "Call Farmer" (native dialer),
 * "Make Offer" bottom sheet with live price-window validation. Rejects any
 * offer outside ±5% of the AGMARKNET benchmark before it reaches the API.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, Alert, Linking, KeyboardAvoidingView, Platform, Image,
  Dimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, SPACING, RADII, SHADOWS } from '../constants/theme';

// Lazy-loaded so the app runs when expo-location isn't bundled.
let Location: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Location = require('expo-location');
} catch { Location = null; }
import {
  fetchListingDetail, submitOffer, ageLabel, resolvePhotoUrl,
  type CommerceListing,
} from '../lib/api';

const fmtIN    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtPrice = (n: number) => `₹${n.toFixed(2)}`;

const CROP_EMOJI: Record<string, string> = {
  Tomato: '🍅', Onion: '🧅', Potato: '🥔', Ragi: '🌾', Maize: '🌽',
  Chili: '🌶️', Wheat: '🌾', Rice: '🌾', Cotton: '🌱', Sugarcane: '🎋',
  Groundnut: '🥜', Brinjal: '🍆', Carrot: '🥕', Cabbage: '🥬',
};

export default function CropDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const listingId = params.id;
  const [listing, setListing] = useState<CommerceListing | null>(null);
  const [showOffer, setShowOffer] = useState(false);

  useEffect(() => {
    if (!listingId) return;
    (async () => {
      // Use the OS's LAST KNOWN position (instant — returns Android's cached
      // GPS fix). getCurrentPositionAsync used to sit here and blocked the
      // whole detail screen for 5–20 s while it re-polled satellites, which
      // made every card tap feel broken. If no cached fix exists, we fire
      // the listing fetch anyway — the /listings/{id} endpoint just returns
      // distance_km=null in that case, which the UI already tolerates.
      let lat: number | undefined, lng: number | undefined;
      if (Location) {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === 'granted') {
            const p = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
            if (p) { lat = p.coords.latitude; lng = p.coords.longitude; }
          }
        } catch {}
      }
      const l = await fetchListingDetail(listingId, lat, lng);
      setListing(l);
    })();
  }, [listingId]);

  if (!listingId) {
    return <SafeAreaView style={s.safe}><Text style={s.errorText}>No listing selected.</Text></SafeAreaView>;
  }

  if (!listing) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const emoji = CROP_EMOJI[listing.crop_name] || '🌱';
  const total = listing.price_per_kg * listing.quantity_kg;

  const belowBenchmark = listing.benchmark_price != null
    && listing.price_verified
    && listing.price_per_kg < listing.benchmark_price;
  const savingsPct = belowBenchmark
    ? Math.round(((listing.benchmark_price! - listing.price_per_kg) / listing.benchmark_price!) * 100)
    : 0;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Full-bleed carousel — sits ABOVE the padded scroll content, so the
            photo goes edge-to-edge like Zomato / Blinkit. Floating back
            button on top-left. */}
        <View style={s.heroWrap}>
          <PhotoCarousel
            photos={listing.photos}
            fallbackUrl={listing.photo_url}
            emoji={emoji}
          />
          <TouchableOpacity onPress={() => router.back()} style={s.floatBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textDark} />
          </TouchableOpacity>
          {belowBenchmark && (
            <View style={s.savingsRibbon}>
              <MaterialCommunityIcons name="tag" size={12} color="#FFF" />
              <Text style={s.savingsText}>{savingsPct}% below market</Text>
            </View>
          )}
        </View>

        {/* Body */}
        <View style={s.body}>
          {/* Title block */}
          <Text style={s.crop}>{listing.crop_name}</Text>
          {listing.crop_name_kn && <Text style={s.cropKn}>{listing.crop_name_kn}</Text>}

          <View style={s.locRow}>
            <Ionicons name="location-sharp" size={13} color={COLORS.primaryDark} />
            <Text style={s.locText} numberOfLines={1}>
              {listing.village || 'Farm'}
              {listing.distance_km != null && `  ·  ${listing.distance_km.toFixed(1)} km away`}
            </Text>
            <Text style={s.locAge}>{ageLabel(listing.created_at).en}</Text>
          </View>

          {/* Price block — big, primary. Total value sits under it as a subtitle. */}
          <View style={s.priceBlock}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={s.priceBig}>{fmtPrice(listing.price_per_kg)}</Text>
              <Text style={s.priceUnit}>/ kg</Text>
              {belowBenchmark && (
                <Text style={s.priceStrike}>{fmtPrice(listing.benchmark_price!)}</Text>
              )}
            </View>
            <Text style={s.totalLine}>
              {listing.quantity_kg} kg total  ·  <Text style={{ fontWeight: '800', color: COLORS.textDark }}>{fmtIN(total)}</Text>
            </Text>
          </View>

          {/* Benchmark context — inline strip when verified, warn when not */}
          {listing.price_verified && listing.benchmark_price != null ? (
            <View style={s.infoStrip}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.accentGreen} />
              <View style={{ flex: 1 }}>
                <Text style={s.infoStripTitle}>
                  Anchored to AGMARKNET · {fmtPrice(listing.benchmark_price)}/kg benchmark
                </Text>
                <Text style={s.infoStripBody}>
                  Fair range {fmtPrice(listing.benchmark_price * 0.95)}–{fmtPrice(listing.benchmark_price * 1.05)}/kg
                </Text>
              </View>
            </View>
          ) : (
            <View style={s.warnStrip}>
              <Ionicons name="alert-circle" size={14} color="#B45309" />
              <Text style={s.warnStripText}>
                No AGMARKNET price today · negotiate carefully
              </Text>
            </View>
          )}

          {/* Farmer trust block */}
          <View style={s.farmerCard}>
            <View style={s.farmerAvatar}>
              <Text style={s.farmerAvatarText}>
                {(listing.farmer_name || 'F').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.farmerLabel}>Sold by · ಮಾರಾಟಗಾರ</Text>
              <Text style={s.farmerName}>{listing.farmer_name || 'Unknown'}</Text>
              {listing.farmer_rating != null && listing.farmer_rating_count > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                  <StarBar stars={listing.farmer_rating} />
                  <Text style={s.farmerRating}>
                    {listing.farmer_rating.toFixed(1)}  ·  {listing.farmer_rating_count} {listing.farmer_rating_count === 1 ? 'sale' : 'sales'}
                  </Text>
                </View>
              ) : (
                <Text style={s.farmerRatingNew}>✨ New farmer · ಹೊಸ ರೈತ</Text>
              )}
            </View>
            {listing.farmer_phone && (
              <TouchableOpacity
                style={s.callIcon}
                onPress={() => Linking.openURL(`tel:${listing.farmer_phone}`)}
                activeOpacity={0.75}
              >
                <Ionicons name="call" size={18} color={COLORS.primaryDark} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Sticky CTA bar — Zomato/Blinkit pattern. Always visible while the
          buyer scrolls; the primary action never disappears offscreen. */}
      <View style={s.stickyBar}>
        <View style={{ flex: 1 }}>
          <Text style={s.stickyPrice}>{fmtIN(total)}</Text>
          <Text style={s.stickyMeta}>{listing.quantity_kg} kg · {fmtPrice(listing.price_per_kg)}/kg</Text>
        </View>
        <TouchableOpacity
          style={s.stickyBtn}
          onPress={() => setShowOffer(true)}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="handshake" size={16} color="#FFF" />
          <Text style={s.stickyBtnText}>Make Offer</Text>
        </TouchableOpacity>
      </View>

      <MakeOfferModal
        visible={showOffer}
        onClose={() => setShowOffer(false)}
        listing={listing}
        onSubmitted={() => { setShowOffer(false); router.replace('/(tabs)/requests'); }}
      />
    </SafeAreaView>
  );
}

/**
 * 5-star row rendered with filled / half / empty icons. Cheap visual
 * representation of a fractional average like 4.6.
 */
function StarBar({ stars }: { stars: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map(i => {
        const name = stars >= i ? 'star' : stars >= i - 0.5 ? 'star-half' : 'star-outline';
        return <Ionicons key={i} name={name as any} size={12} color="#D97706" />;
      })}
    </View>
  );
}

/**
 * Horizontal-paging photo carousel. Renders `photos[]` at full hero width,
 * with a dots indicator below and an "N/M" pill in the top-right when more
 * than one photo. Falls back to legacy single photo_url, then to the crop emoji.
 */
/**
 * Full-bleed horizontal-paging carousel. Photos are exactly SCREEN_W wide so
 * pagingEnabled snaps cleanly. No inner padding to fight the container.
 * Dots + N/M pill overlay directly on the photo (Zomato/Blinkit pattern).
 * Falls back to legacy single photo_url, then to the crop emoji.
 */
function PhotoCarousel({
  photos, fallbackUrl, emoji,
}: {
  photos: { id: string; url: string }[]; fallbackUrl: string | null; emoji: string;
}) {
  const [idx, setIdx] = useState(0);
  const urls = (photos && photos.length > 0)
    ? photos.map(p => resolvePhotoUrl(p.url)!).filter(Boolean)
    : (fallbackUrl ? [resolvePhotoUrl(fallbackUrl)!] : []);

  if (urls.length === 0) {
    return (
      <View style={s.heroEmpty}>
        <Text style={{ fontSize: 96 }}>{emoji}</Text>
      </View>
    );
  }
  if (urls.length === 1) {
    return <Image source={{ uri: urls[0] }} style={s.heroFull} resizeMode="cover" />;
  }
  return (
    <View>
      <ScrollView
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
          setIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))
        }
        scrollEventThrottle={16}
      >
        {urls.map((u, i) => (
          <Image
            key={i}
            source={{ uri: u }}
            style={[s.heroFull, { width: SCREEN_W }]}
            resizeMode="cover"
          />
        ))}
      </ScrollView>
      <View style={s.carouselPill}>
        <Ionicons name="images" size={10} color="#FFF" />
        <Text style={s.carouselPillText}>{idx + 1}/{urls.length}</Text>
      </View>
      <View style={s.carouselDots}>
        {urls.map((_, i) => (
          <View key={i} style={[s.carouselDot, i === idx && s.carouselDotActive]} />
        ))}
      </View>
    </View>
  );
}

// (Metric sub-component removed — was left dangling after the crop-detail
// hero redesign that replaced the tile row with the priceBlock + infoStrip
// layout. Its styles are already gone from the stylesheet.)

function MakeOfferModal({
  visible, onClose, listing, onSubmitted,
}: {
  visible: boolean; onClose: () => void; listing: CommerceListing; onSubmitted: () => void;
}) {
  const [price, setPrice]     = useState(String(listing.price_per_kg));
  const [qty, setQty]         = useState(String(listing.quantity_kg));
  const [note, setNote]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setPrice(String(listing.price_per_kg));
      setQty(String(listing.quantity_kg));
      setNote('');
    }
  }, [visible, listing.id]);

  const priceN = parseFloat(price) || 0;
  const qtyN   = parseFloat(qty)   || 0;

  const benchmark = listing.benchmark_price;
  const floor   = benchmark != null ? +(benchmark * 0.95).toFixed(2) : null;
  const ceiling = benchmark != null ? +(benchmark * 1.05).toFixed(2) : null;
  const priceOk = benchmark == null || (floor != null && ceiling != null && priceN >= floor && priceN <= ceiling);
  const qtyOk   = qtyN > 0 && qtyN <= listing.quantity_kg;

  const submit = async () => {
    if (inFlightRef.current) return;
    if (!priceOk || !qtyOk) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const r = await submitOffer(listing.id, {
        offered_price_per_kg: priceN,
        quantity_kg:          qtyN,
        note:                 note.trim() || null,
      });
      if (r) onSubmitted();
      else Alert.alert('Could not submit', 'Backend rejected the offer. Check the fair range.');
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        style={s.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <TouchableOpacity style={s.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={[s.sheet, { maxHeight: '88%' }]}>
          <View style={s.sheetHandle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={s.sheetTitle}>Make an offer</Text>
            <Text style={s.sheetSubtitle}>ಬಿಡ್ ಮಾಡಿ · {listing.crop_name}</Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Your price ₹/kg</Text>
                <TextInput
                  style={[s.input, !priceOk && s.inputError]}
                  value={price} onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0" placeholderTextColor={COLORS.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Quantity (kg)</Text>
                <TextInput
                  style={[s.input, !qtyOk && s.inputError]}
                  value={qty} onChangeText={setQty}
                  keyboardType="decimal-pad"
                  placeholder="0" placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>

            {benchmark != null && (
              <View style={s.hintBox}>
                <Ionicons
                  name={priceOk ? 'checkmark-circle' : 'alert-circle'}
                  size={14}
                  color={priceOk ? COLORS.primary : COLORS.accentRed}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.hintText}>
                    Fair range: {fmtPrice(floor!)}–{fmtPrice(ceiling!)}/kg
                  </Text>
                  <Text style={s.hintKn}>±5% of AGMARKNET benchmark</Text>
                  {!priceOk && (
                    <Text style={s.hintError}>
                      Your offer is outside the fair range.
                    </Text>
                  )}
                </View>
              </View>
            )}

            {!qtyOk && (
              <Text style={s.qtyError}>
                Quantity must be between 1 and {listing.quantity_kg} kg.
              </Text>
            )}

            <View style={s.totalPreview}>
              <Text style={s.totalPreviewLabel}>Offer total</Text>
              <Text style={s.totalPreviewValue}>{fmtIN(priceN * qtyN)}</Text>
            </View>

            <Text style={s.label}>Note (optional)</Text>
            <TextInput
              style={[s.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={note} onChangeText={setNote}
              placeholder="Pickup by evening tomorrow, etc."
              placeholderTextColor={COLORS.textMuted}
              multiline
            />

            <TouchableOpacity
              style={[s.submitBtn, (submitting || !priceOk || !qtyOk) && s.submitDisabled]}
              onPress={submit}
              disabled={submitting || !priceOk || !qtyOk}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color="#FFF" />
                : <Text style={s.submitText}>Submit offer · ಬಿಡ್ ಸಲ್ಲಿಸಿ</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const HERO_H = 300;

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { paddingBottom: 100 },   // no side padding — hero is edge-to-edge
  errorText: { textAlign: 'center', color: COLORS.textMuted, marginTop: 40 },

  // ── Hero (full-bleed carousel) ─────────────────────────────────
  heroWrap: { width: SCREEN_W, height: HERO_H, backgroundColor: COLORS.primaryLightBg },
  heroFull: { width: SCREEN_W, height: HERO_H },
  heroEmpty:{ width: SCREEN_W, height: HERO_H, alignItems: 'center', justifyContent: 'center',
              backgroundColor: COLORS.primaryLightBg },
  floatBack: {
    position: 'absolute', top: 12, left: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    ...SHADOWS.card,
  },
  savingsRibbon: {
    position: 'absolute', top: 16, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.accentRed,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADII.pill,
    ...SHADOWS.card,
  },
  savingsText: { fontSize: 11, fontWeight: '800', color: '#FFF' },
  carouselPill: {
    position: 'absolute', bottom: 24, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADII.pill,
  },
  carouselPillText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  carouselDots: {
    position: 'absolute', bottom: 10, alignSelf: 'center',
    flexDirection: 'row', gap: 5,
  },
  carouselDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)',
  },
  carouselDotActive: { backgroundColor: '#FFF', width: 20 },

  // ── Body ─────────────────────────────────
  body: { padding: SPACING.lg },
  crop:   { fontSize: 26, fontWeight: '800', color: COLORS.textDark, letterSpacing: -0.3 },
  cropKn: { fontSize: 15, fontWeight: '700', color: COLORS.textBody, marginTop: 2 },

  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  locText:{ flex: 1, fontSize: 13, fontWeight: '600', color: COLORS.textBody },
  locAge: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },

  priceBlock: {
    marginTop: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.md,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.borderLight,
  },
  priceBig:   { fontSize: 32, fontWeight: '800', color: COLORS.primaryDark, letterSpacing: -0.8 },
  priceUnit:  { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  priceStrike:{ fontSize: 14, color: COLORS.textMuted, marginLeft: 6,
                textDecorationLine: 'line-through' },
  totalLine:  { fontSize: 13, color: COLORS.textBody, marginTop: 6 },

  infoStrip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: SPACING.md, padding: 10, borderRadius: RADII.md,
    backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#86EFAC',
  },
  infoStripTitle: { fontSize: 12, fontWeight: '800', color: '#166534' },
  infoStripBody:  { fontSize: 11, color: '#15803D', marginTop: 1 },
  warnStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: SPACING.md, padding: 10, borderRadius: RADII.md,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A',
  },
  warnStripText:  { flex: 1, fontSize: 12, fontWeight: '700', color: '#92400E' },

  farmerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: SPACING.md, padding: SPACING.md,
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
  },
  farmerAvatar:{ width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primaryLightBg,
                 alignItems: 'center', justifyContent: 'center' },
  farmerAvatarText: { fontSize: 20, fontWeight: '800', color: COLORS.primaryDark },
  farmerLabel:{ fontSize: 10, fontWeight: '700', color: COLORS.textMuted,
                textTransform: 'uppercase', letterSpacing: 0.5 },
  farmerName: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 2 },
  farmerRating: { fontSize: 11, fontWeight: '700', color: '#B45309' },
  farmerRatingNew: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, marginTop: 3, fontStyle: 'italic' },
  callIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primaryLightBg, borderWidth: 1, borderColor: COLORS.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Sticky bottom CTA ─────────────────────────────────
  stickyBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: SPACING.lg, paddingTop: 12, paddingBottom: 18,
    backgroundColor: COLORS.bgCard,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    ...SHADOWS.card,
  },
  stickyPrice: { fontSize: 18, fontWeight: '800', color: COLORS.primaryDark },
  stickyMeta:  { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  stickyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: RADII.pill, ...SHADOWS.card,
  },
  stickyBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: COLORS.bgCard, borderTopLeftRadius: RADII.xl, borderTopRightRadius: RADII.xl,
                  padding: SPACING.xl, paddingBottom: 40, ...SHADOWS.popover },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.borderDark,
                  alignSelf: 'center', marginBottom: SPACING.md },
  sheetTitle:   { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  sheetSubtitle:{ fontSize: 12, color: COLORS.textMuted, marginBottom: SPACING.md, marginTop: 2 },

  label:      { fontSize: 12, fontWeight: '700', color: COLORS.textDark, marginTop: 10, marginBottom: 6 },
  input:      { backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
                borderRadius: RADII.md, paddingHorizontal: 14, paddingVertical: 10,
                fontSize: 14, color: COLORS.textDark },
  inputError: { borderColor: COLORS.accentRed },

  hintBox:  { flexDirection: 'row', gap: 6, backgroundColor: COLORS.primaryLightBg,
              padding: SPACING.md, borderRadius: RADII.md, marginTop: 10,
              borderWidth: 1, borderColor: COLORS.primaryTint },
  hintText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  hintKn:   { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },
  hintError:{ fontSize: 11, color: COLORS.accentRed, fontWeight: '700', marginTop: 4 },
  qtyError: { fontSize: 11, color: COLORS.accentRed, fontWeight: '700', marginTop: 6 },

  totalPreview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: COLORS.bgSubtle, borderRadius: RADII.md, padding: SPACING.md,
                  marginTop: SPACING.md },
  totalPreviewLabel: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase' },
  totalPreviewValue: { fontSize: 18, fontWeight: '800', color: COLORS.primary },

  submitBtn: { backgroundColor: COLORS.primaryDark, borderRadius: RADII.pill, paddingVertical: 14,
               alignItems: 'center', marginTop: SPACING.lg, ...SHADOWS.card },
  submitText:{ fontSize: 15, fontWeight: '800', color: '#FFF' },
  submitDisabled: { opacity: 0.5 },
});
