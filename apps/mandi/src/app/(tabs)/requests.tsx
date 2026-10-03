/**
 * Requests / Offers tab — Mandi buyer app.
 *
 * All counter-offers the buyer has submitted, grouped by status. Pending
 * offers can be withdrawn while they're still open. Auto-expires after 48h
 * are surfaced as EXPIRED without any buyer action needed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import { fetchMyOffers, withdrawOffer, hideOfferFromBuyer, ageLabel, type CommerceOffer, type OfferStatus } from '../../lib/api';

const fmtIN    = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtPrice = (n: number) => `₹${n.toFixed(2)}`;

const STATUS_META: Record<OfferStatus, { label: string; kn: string; color: string; bg: string }> = {
  PENDING:     { label: 'Pending',      kn: 'ಬಾಕಿ',           color: '#B45309', bg: '#FEF3C7' },
  ACCEPTED:    { label: 'Accepted',     kn: 'ಸ್ವೀಕರಿಸಿದೆ',    color: '#166534', bg: '#DCFCE7' },
  IN_DELIVERY: { label: 'In delivery',  kn: 'ದಾರಿಯಲ್ಲಿ',      color: '#1D4ED8', bg: '#DBEAFE' },
  COMPLETED:   { label: 'Delivered',    kn: 'ತಲುಪಿದೆ',        color: '#166534', bg: '#DCFCE7' },
  REJECTED:    { label: 'Rejected',     kn: 'ತಿರಸ್ಕರಿಸಿದೆ',   color: COLORS.accentRed, bg: COLORS.accentRedBg },
  WITHDRAWN:   { label: 'Withdrawn',    kn: 'ಹಿಂಪಡೆದಿದೆ',    color: COLORS.textMuted, bg: COLORS.bgSubtle },
  EXPIRED:     { label: 'Expired',      kn: 'ಅವಧಿ ಮುಗಿದಿದೆ', color: COLORS.textMuted, bg: COLORS.bgSubtle },
  CANCELLED:   { label: 'Cancelled',    kn: 'ರದ್ದು',          color: COLORS.accentRed, bg: COLORS.accentRedBg },
};

export default function OffersScreen() {
  const [offers, setOffers] = useState<CommerceOffer[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchMyOffers();
    setOffers(r ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload when the buyer navigates back so an offer that just flipped
  // status (farmer accepted → moves to Orders, or rejected → moves to
  // Closed) is reflected without waiting for a manual pull-to-refresh.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const dismissClosed = async (id: string) => {
    // Optimistic — drop it locally, then reconcile against the backend.
    setOffers(prev => (prev ?? []).filter(o => o.id !== id));
    try { await hideOfferFromBuyer(id); }
    catch { /* if it fails, next load will bring it back honestly */ }
  };

  const withdraw = async (id: string) => {
    setBusy(id);
    const r = await withdrawOffer(id);
    setBusy(null);
    if (r) load();
    else Alert.alert('Could not withdraw', 'The offer may have already been answered.');
  };

  const pending  = (offers ?? []).filter(o => o.status === 'PENDING');
  const closed   = (offers ?? []).filter(o => o.status !== 'PENDING');

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>My Offers</Text>
            <Text style={s.titleKn}>ನನ್ನ ಬಿಡ್‌ಗಳು</Text>
            <Text style={s.subtitle}>Counter-offers you've submitted · 48h expiry</Text>
          </View>
        </View>

        {offers == null && <ActivityIndicator style={{ marginVertical: 24 }} color={COLORS.primary} />}

        {offers && offers.length === 0 && (
          <View style={s.empty}>
            <MaterialCommunityIcons name="handshake-outline" size={48} color={COLORS.textMuted} />
            <Text style={s.emptyTitle}>No offers yet</Text>
            <Text style={s.emptyTitleKn}>ಇನ್ನೂ ಯಾವ ಬಿಡ್ ಇಲ್ಲ</Text>
            <Text style={s.emptyMsg}>
              Go to Discover to find nearby crops, then make an offer.
            </Text>
          </View>
        )}

        {pending.length > 0 && (
          <>
            <SectionHeader en="Pending" kn="ಬಾಕಿ" count={pending.length} />
            {pending.map(o => (
              <OfferCard key={o.id} offer={o}
                onWithdraw={() => withdraw(o.id)}
                busy={busy === o.id} />
            ))}
          </>
        )}

        {closed.length > 0 && (
          <>
            <SectionHeader en="Closed" kn="ಮುಚ್ಚಿದೆ" count={closed.length} />
            {closed.map(o => (
              <OfferCard key={o.id} offer={o} onDismiss={() => dismissClosed(o.id)} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ en, kn, count }: { en: string; kn: string; count: number }) {
  return (
    <View style={s.sectionHeader}>
      <View>
        <Text style={s.sectionTitle}>{en}</Text>
        <Text style={s.sectionKn}>{kn}</Text>
      </View>
      <View style={s.countPill}><Text style={s.countText}>{count}</Text></View>
    </View>
  );
}

function OfferCard({
  offer, onWithdraw, onDismiss, busy = false,
}: { offer: CommerceOffer; onWithdraw?: () => void; onDismiss?: () => void; busy?: boolean }) {
  const meta = STATUS_META[offer.status];
  const total = offer.offered_price_per_kg * offer.quantity_kg;
  const age = ageLabel(offer.created_at).en;

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
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardCrop}>{offer.listing_crop || 'Listing'}</Text>
          <Text style={s.cardMeta}>{offer.quantity_kg} kg × {fmtPrice(offer.offered_price_per_kg)}</Text>
          <Text style={s.cardTotal}>{fmtIN(total)}</Text>
          <Text style={s.cardAge}>Sent {age}</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: meta.bg, marginRight: onDismiss ? 24 : 0 }]}>
          <Text style={[s.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {offer.note && (
        <Text style={s.cardNote}>"{offer.note}"</Text>
      )}

      {offer.status === 'PENDING' && onWithdraw && (
        <TouchableOpacity
          style={[s.withdrawBtn, busy && { opacity: 0.5 }]}
          onPress={onWithdraw}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator size="small" color={COLORS.accentRed} />
            : <>
                <Ionicons name="close-circle-outline" size={13} color={COLORS.accentRed} />
                <Text style={s.withdrawText}>Withdraw · ಹಿಂಪಡೆ</Text>
              </>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.lg, paddingBottom: 100 },

  header: { marginBottom: SPACING.lg },
  title:  { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  titleKn:{ fontSize: 14, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  subtitle:{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   marginTop: SPACING.md, marginBottom: SPACING.sm },
  sectionTitle:  { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  sectionKn:     { fontSize: 11, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  countPill:     { backgroundColor: COLORS.bgSubtle, paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADII.pill },
  countText:     { fontSize: 11, fontWeight: '800', color: COLORS.textDark },

  empty: { alignItems: 'center', padding: SPACING.xxl, backgroundColor: COLORS.bgCard,
           borderRadius: RADII.lg, borderWidth: 1, borderColor: COLORS.border, gap: 6 },
  emptyTitle:   { fontSize: 15, fontWeight: '800', color: COLORS.textDark, marginTop: 8 },
  emptyTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody },
  emptyMsg:     { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 17, marginTop: 6 },

  card: { backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: SPACING.md, marginBottom: 10,
          borderWidth: 1, borderColor: COLORS.border, position: 'relative', ...SHADOWS.card },
  dismissBtn: {
    position: 'absolute', top: 6, right: 6, zIndex: 2,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bgSubtle,
  },
  cardCrop:  { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  cardMeta:  { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  cardTotal: { fontSize: 17, fontWeight: '800', color: COLORS.primary, marginTop: 4 },
  cardAge:   { fontSize: 10, color: COLORS.textMuted, marginTop: 3 },
  cardNote:  { fontSize: 11, color: COLORS.textBody, marginTop: 8, fontStyle: 'italic' },
  statusPill:{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill },
  statusText:{ fontSize: 10, fontWeight: '800' },

  withdrawBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                 marginTop: 10, paddingVertical: 9, borderRadius: RADII.pill,
                 backgroundColor: COLORS.accentRedBg, borderWidth: 1, borderColor: '#FCA5A5' },
  withdrawText:{ fontSize: 12, fontWeight: '700', color: COLORS.accentRed },
});
