/**
 * Orders tab — Mandi buyer app.
 *
 * Two sub-tabs:
 *   • In Delivery — accepted offers on the way. Buyer's OTP is DISPLAYED
 *     here; buyer reads it out on delivery, farmer verifies it in their app.
 *   • Past Orders — completed trades (delivery confirmed).
 *
 * Trust rule: the BUYER holds the OTP. Farmer must know it (from buyer) to
 * close the trade — proof that the crop physically reached the buyer.
 * Until the farmer verifies, no income posts to their plot ledger.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import {
  fetchMyOrders, fetchMyDeliveries, hideOfferFromBuyer, rateFarmer,
  ageLabel, parseServerTs, resolvePhotoUrl,
  type CommerceOffer,
} from '../../lib/api';

const fmtIN    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtPrice = (n: number) => `₹${n.toFixed(2)}`;

type SubTab = 'delivery' | 'past';

export default function OrdersScreen() {
  const [tab, setTab] = useState<SubTab>('delivery');
  const [deliveries, setDeliveries] = useState<CommerceOffer[] | null>(null);
  const [orders, setOrders] = useState<CommerceOffer[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([fetchMyDeliveries(), fetchMyOrders()]);
    setDeliveries(d ?? []);
    setOrders(o ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Reload every time the buyer navigates back to this tab. Without this,
  // a delivery that the farmer just completed (offer flips COMPLETED
  // server-side) doesn't show up until the buyer pulls-to-refresh — which
  // is exactly the bug farmers reported ("Mandi says complete, but the
  // Delivery tab still shows it as in-progress").
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const list = tab === 'delivery' ? deliveries : orders;

  const dismissPast = async (id: string) => {
    // Optimistic remove — reconciles on next load if the backend refuses.
    setOrders(prev => (prev ?? []).filter(o => o.id !== id));
    try { await hideOfferFromBuyer(id); }
    catch { /* silent — reload will restore */ }
  };

  const submitRating = async (id: string, stars: number) => {
    // Optimistic — flip the local `rated` flag so the stars vanish immediately.
    setOrders(prev => (prev ?? []).map(o => o.id === id ? { ...o, rated: true } : o));
    const r = await rateFarmer(id, stars);
    if (!r) {
      // Backend refused — restore so the buyer can try again.
      setOrders(prev => (prev ?? []).map(o => o.id === id ? { ...o, rated: false } : o));
    }
  };
  const totalSpent = (orders ?? []).reduce((s, o) => s + o.offered_price_per_kg * o.quantity_kg, 0);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Orders</Text>
            <Text style={s.titleKn}>ಆದೇಶಗಳು</Text>
            <Text style={s.subtitle}>Track deliveries and past trades</Text>
          </View>
        </View>

        {/* Tab bar */}
        <View style={s.tabBar}>
          <TabBtn
            active={tab === 'delivery'}
            label="In Delivery"
            kn="ದಾರಿಯಲ್ಲಿ"
            count={deliveries?.length ?? 0}
            onPress={() => setTab('delivery')}
          />
          <TabBtn
            active={tab === 'past'}
            label="Past Orders"
            kn="ಹಿಂದಿನವು"
            count={orders?.length ?? 0}
            onPress={() => setTab('past')}
          />
        </View>

        {/* Past-orders header stat */}
        {tab === 'past' && (orders?.length ?? 0) > 0 && (
          <View style={s.statBar}>
            <MaterialCommunityIcons name="cash-multiple" size={16} color={COLORS.primaryDark} />
            <Text style={s.statBarLabel}>Total spent</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.statBarValue}>{fmtIN(totalSpent)}</Text>
          </View>
        )}

        {list == null && <ActivityIndicator style={{ marginVertical: 24 }} color={COLORS.primary} />}

        {list != null && list.length === 0 && (
          <EmptyState tab={tab} />
        )}

        {list?.map(o => (
          tab === 'delivery'
            ? <DeliveryCard key={o.id} offer={o} />
            : <PastOrderCard
                key={o.id}
                offer={o}
                onDismiss={() => dismissPast(o.id)}
                onRate={(stars) => submitRating(o.id, stars)}
              />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function TabBtn({
  active, label, kn, count, urgent = false, onPress,
}: {
  active: boolean; label: string; kn: string; count: number; urgent?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.tab, active && s.tabActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
        <View style={[s.tabCount, urgent && count > 0 && s.tabCountUrgent]}>
          <Text style={[s.tabCountText, urgent && count > 0 && s.tabCountUrgentText]}>{count}</Text>
        </View>
      </View>
      <Text style={[s.tabKn, active && s.tabLabelActive]}>{kn}</Text>
    </TouchableOpacity>
  );
}

function EmptyState({ tab }: { tab: SubTab }) {
  return (
    <View style={s.empty}>
      <MaterialCommunityIcons
        name={tab === 'delivery' ? 'truck-fast-outline' : 'clipboard-check-outline'}
        size={48} color={COLORS.textMuted}
      />
      <Text style={s.emptyTitle}>
        {tab === 'delivery' ? 'No deliveries in progress' : 'No completed orders yet'}
      </Text>
      <Text style={s.emptyTitleKn}>
        {tab === 'delivery' ? 'ದಾರಿಯಲ್ಲಿ ಯಾವ ಆದೇಶವಿಲ್ಲ' : 'ಇನ್ನೂ ಪೂರ್ಣ ಆದೇಶವಿಲ್ಲ'}
      </Text>
      <Text style={s.emptyMsg}>
        {tab === 'delivery'
          ? 'When a farmer accepts your offer, the order appears here with an OTP flow.'
          : 'Complete deliveries by entering the farmer\'s OTP — they land here.'}
      </Text>
    </View>
  );
}

function DeliveryCard({ offer }: { offer: CommerceOffer }) {
  const total = offer.offered_price_per_kg * offer.quantity_kg;
  const photoUrl = resolvePhotoUrl(offer.listing_photo_url);
  const ageStr = offer.responded_at
    ? ageLabel(offer.responded_at).en
    : ageLabel(offer.created_at).en;

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={s.thumbWrap}>
          {photoUrl
            ? <Image source={{ uri: photoUrl }} style={s.thumb} />
            : <View style={s.thumbEmpty}><MaterialCommunityIcons name="basket" size={22} color={COLORS.textMuted} /></View>}
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.statusPill}>
            <View style={s.statusDot} />
            <Text style={s.statusText}>In delivery · {ageStr}</Text>
          </View>
          <Text style={s.cardCrop}>{offer.listing_crop ?? 'Order'}</Text>
          <Text style={s.cardMeta}>
            {offer.quantity_kg} kg × {fmtPrice(offer.offered_price_per_kg)}
          </Text>
          <Text style={s.cardTotal}>{fmtIN(total)}</Text>
        </View>
      </View>

      <View style={s.farmerRow}>
        <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
        <Text style={s.farmerText} numberOfLines={1}>
          {offer.farmer_name ?? 'Farmer'}
          {offer.listing_village ? ` · ${offer.listing_village}` : ''}
        </Text>
      </View>

      {/* OTP display — the buyer's proof of possession. Show it big and
          isolated so it's clear this is a secret to guard until delivery. */}
      <View style={s.otpBox}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Ionicons name="shield-checkmark" size={14} color="#FFF" />
          <Text style={s.otpLabel}>Your delivery OTP</Text>
        </View>
        <Text style={s.otpDigits}>{offer.delivery_otp ?? '——————'}</Text>
        <Text style={s.otpWarn}>
          Share ONLY when the crop is in your hands. The farmer types this
          into their app to complete the sale.
        </Text>
      </View>

      {offer.farmer_phone && (
        <TouchableOpacity
          style={s.callFullBtn}
          onPress={() => Linking.openURL(`tel:${offer.farmer_phone}`)}
          activeOpacity={0.85}
        >
          <Ionicons name="call" size={13} color="#FFF" />
          <Text style={s.callFullText}>
            Call {offer.farmer_name ?? 'farmer'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function PastOrderCard({
  offer, onDismiss, onRate,
}: { offer: CommerceOffer; onDismiss?: () => void; onRate?: (stars: number) => void }) {
  const total = offer.offered_price_per_kg * offer.quantity_kg;
  const photoUrl = resolvePhotoUrl(offer.listing_photo_url);
  const isCancelled = offer.status === 'CANCELLED';
  const stateColor = isCancelled ? COLORS.accentRed : '#059669';
  const stateLabel = isCancelled ? 'Cancelled' : 'Delivered';
  const canRate = onRate && offer.status === 'COMPLETED' && !offer.rated;
  return (
    <View style={s.card}>
      {onDismiss && (
        <TouchableOpacity
          style={s.dismissBtn}
          onPress={onDismiss}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={14} color={COLORS.textMuted} />
        </TouchableOpacity>
      )}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={s.thumbWrap}>
          {photoUrl
            ? <Image source={{ uri: photoUrl }} style={s.thumb} />
            : <View style={s.thumbEmpty}><MaterialCommunityIcons name="basket" size={22} color={COLORS.textMuted} /></View>}
        </View>
        <View style={{ flex: 1 }}>
          <View style={[s.doneBadge, isCancelled && { backgroundColor: COLORS.accentRedBg, borderColor: '#FCA5A5' }]}>
            <Ionicons
              name={isCancelled ? 'close-circle' : 'checkmark-circle'}
              size={11} color={stateColor}
            />
            <Text style={[s.doneBadgeText, { color: stateColor }]}>{stateLabel}</Text>
          </View>
          <Text style={s.cardCrop}>{offer.listing_crop ?? 'Order'}</Text>
          <Text style={s.cardMeta}>
            {offer.quantity_kg} kg × {fmtPrice(offer.offered_price_per_kg)}
          </Text>
          <Text style={s.cardTotal}>{fmtIN(total)}</Text>
          {offer.completed_at && (
            <Text style={s.completedAt}>
              {new Date(parseServerTs(offer.completed_at)).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </Text>
          )}
          {isCancelled && offer.cancelled_reason && (
            <View style={s.cancelReason}>
              <Ionicons name="alert-circle-outline" size={11} color={COLORS.accentRed} />
              <Text style={s.cancelReasonText}>Farmer: {offer.cancelled_reason}</Text>
            </View>
          )}
        </View>
      </View>
      {canRate && (
        <View style={s.rateBox}>
          <Text style={s.rateLabel}>Rate {offer.farmer_name ?? 'the farmer'} · ರೇಟಿಂಗ್ ನೀಡಿ</Text>
          <View style={s.starRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity
                key={n}
                onPress={() => onRate!(n)}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                activeOpacity={0.7}
              >
                <Ionicons name="star-outline" size={26} color="#D97706" />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.rateHint}>Tap a star — helps other buyers choose good farmers.</Text>
        </View>
      )}
      {offer.rated && offer.status === 'COMPLETED' && (
        <View style={s.ratedRow}>
          <Ionicons name="checkmark-circle" size={12} color="#059669" />
          <Text style={s.ratedText}>Rated · ರೇಟಿಂಗ್ ಸಲ್ಲಿಸಲಾಗಿದೆ</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.lg, paddingBottom: 100 },

  header:   { marginBottom: SPACING.lg },
  title:    { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  titleKn:  { fontSize: 14, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },

  // Tab bar
  tabBar: {
    flexDirection: 'row', gap: 8, backgroundColor: COLORS.bgSubtle,
    borderRadius: RADII.lg, padding: 4, marginBottom: SPACING.md,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: RADII.md,
  },
  tabActive:      { backgroundColor: COLORS.bgCard, ...SHADOWS.card },
  tabLabel:       { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  tabLabelActive: { color: COLORS.primaryDark },
  tabKn:          { fontSize: 10, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  tabCount:  {
    minWidth: 20, height: 18, borderRadius: 9, backgroundColor: COLORS.bgSubtle,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabCountText:  { fontSize: 10, fontWeight: '800', color: COLORS.textMuted },
  tabCountUrgent: { backgroundColor: COLORS.accentRed, borderColor: COLORS.accentRed },
  tabCountUrgentText: { color: '#FFF' },

  // Header stat
  statBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.primaryLightBg,
    padding: SPACING.md, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.primaryTint,
    marginBottom: SPACING.md,
  },
  statBarLabel: { fontSize: 12, fontWeight: '700', color: COLORS.primaryDark },
  statBarValue: { fontSize: 15, fontWeight: '800', color: COLORS.primaryDark },

  // Empty
  empty: { alignItems: 'center', padding: SPACING.xxl, backgroundColor: COLORS.bgCard,
           borderRadius: RADII.lg, borderWidth: 1, borderColor: COLORS.border, gap: 6 },
  emptyTitle:   { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 8, textAlign: 'center' },
  emptyTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody },
  emptyMsg:     { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 17, marginTop: 6 },

  // Card
  card: { backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: SPACING.md, marginBottom: 10,
          borderWidth: 1, borderColor: COLORS.border, position: 'relative', ...SHADOWS.card },
  dismissBtn: {
    position: 'absolute', top: 6, right: 6, zIndex: 2,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bgSubtle,
  },
  thumbWrap: { width: 60, height: 60, borderRadius: RADII.md, overflow: 'hidden', backgroundColor: COLORS.primaryLightBg },
  thumb:     { width: 60, height: 60 },
  thumbEmpty:{ width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', backgroundColor: '#DBEAFE',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADII.pill,
    borderWidth: 1, borderColor: '#93C5FD',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2563EB' },
  statusText: { fontSize: 10, fontWeight: '700', color: '#1D4ED8' },
  cardCrop:  { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 4 },
  cardMeta:  { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  cardTotal: { fontSize: 16, fontWeight: '800', color: COLORS.primaryDark, marginTop: 3 },

  farmerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10,
               paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  farmerText: { flex: 1, fontSize: 11, color: COLORS.textBody, fontWeight: '600' },

  // OTP display card — buyer's proof of possession
  otpBox: {
    marginTop: 12, padding: SPACING.md, borderRadius: RADII.lg,
    backgroundColor: COLORS.primaryDark, alignItems: 'center',
  },
  otpLabel:  { fontSize: 11, fontWeight: '800', color: '#FFF',
               letterSpacing: 1, textTransform: 'uppercase' },
  otpDigits: { fontSize: 34, fontWeight: '800', color: '#FFF',
               letterSpacing: 12, marginTop: 4, marginLeft: 12 },
  otpWarn:   { fontSize: 11, color: 'rgba(255,255,255,0.8)',
               textAlign: 'center', marginTop: 10, lineHeight: 15,
               paddingHorizontal: 4 },

  callFullBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: RADII.pill,
    marginTop: 10,
  },
  callFullText: { fontSize: 13, fontWeight: '800', color: '#FFF' },

  doneBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', backgroundColor: '#DCFCE7',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADII.pill,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  doneBadgeText: { fontSize: 10, fontWeight: '700' },
  completedAt:   { fontSize: 10, color: COLORS.textMuted, marginTop: 4 },
  cancelReason:  { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 8,
                   padding: 8, backgroundColor: COLORS.accentRedBg, borderRadius: RADII.md },
  cancelReasonText:{ flex: 1, fontSize: 11, color: COLORS.accentRed, fontWeight: '600' },

  // Rate-farmer prompt
  rateBox: {
    marginTop: 12, padding: SPACING.md, borderRadius: RADII.md,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    alignItems: 'center',
  },
  rateLabel: { fontSize: 12, fontWeight: '800', color: '#92400E' },
  starRow:   { flexDirection: 'row', gap: 8, marginTop: 8 },
  rateHint:  { fontSize: 10, color: '#B45309', marginTop: 6, textAlign: 'center' },
  ratedRow:  {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.borderLight,
  },
  ratedText: { fontSize: 11, fontWeight: '700', color: '#059669' },
});
