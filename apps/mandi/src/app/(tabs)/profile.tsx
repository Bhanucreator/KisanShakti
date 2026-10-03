/**
 * Profile tab — Mandi buyer app.
 *
 * Shop info + live trade stats. Stats derived from real orders — the "top
 * crop" / "most-frequent seller" lines only show when there's actual data
 * (never a placeholder that lies).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import { useAuth } from '../../hooks/use-auth';
import { fetchMyOrders, type CommerceOffer } from '../../lib/api';

const fmtIN = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function ProfileScreen() {
  const auth = useAuth();
  const [orders, setOrders] = useState<CommerceOffer[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchMyOrders();
    setOrders(r ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const totalSpent = (orders ?? []).reduce((s, o) => s + o.offered_price_per_kg * o.quantity_kg, 0);
  const orderCount = (orders ?? []).length;
  const uniqueCrops = new Set((orders ?? []).map(o => o.listing_crop).filter(Boolean)).size;

  const initial = (auth.buyerName || 'B').charAt(0).toUpperCase();

  const signOut = () => {
    Alert.alert(
      'Sign out?',
      'You can sign back in with the same phone number.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => {
          await auth.signOut();
          router.replace('/login');
        }},
      ],
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <View style={s.identity}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initial}</Text>
          </View>
          <Text style={s.name}>{auth.buyerName || 'Buyer'}</Text>
          <View style={s.roleBadge}>
            <MaterialCommunityIcons name="storefront" size={11} color={COLORS.primary} />
            <Text style={s.roleText}>{auth.shopType || 'BUYER'} · ಖರೀದಿದಾರ</Text>
          </View>
        </View>

        {/* Trade stats — derived, never fabricated */}
        <Text style={s.sectionLabel}>Trade Activity · ವ್ಯಾಪಾರ ಚಟುವಟಿಕೆ</Text>

        {orders == null ? (
          <ActivityIndicator style={{ marginVertical: 16 }} color={COLORS.primary} />
        ) : orders.length === 0 ? (
          <View style={s.emptyStats}>
            <Text style={s.emptyStatsText}>
              No trades yet · ಇನ್ನೂ ವ್ಯಾಪಾರವಿಲ್ಲ{'\n'}
              Complete an order in Discover to see your stats.
            </Text>
          </View>
        ) : (
          <View style={s.statsCard}>
            <StatLine icon="cash-outline"  label="Total spent"      value={fmtIN(totalSpent)} />
            <View style={s.divider} />
            <StatLine icon="receipt-outline" label="Orders completed" value={String(orderCount)} />
            <View style={s.divider} />
            <StatLine icon="sparkles-outline" label="Crop types bought" value={String(uniqueCrops)} />
          </View>
        )}

        {/* Personal info */}
        <Text style={s.sectionLabel}>Personal Info · ವೈಯಕ್ತಿಕ ಮಾಹಿತಿ</Text>
        <View style={s.infoCard}>
          <InfoRow icon="phone-portrait-outline" label="Mobile" value={auth.phone || '—'} />
          <View style={s.divider} />
          <InfoRow icon="id-card-outline"        label="Buyer ID" value={auth.buyerId?.slice(0, 8) || '—'} />
        </View>

        {/* Settings */}
        <Text style={s.sectionLabel}>Settings · ಸೆಟ್ಟಿಂಗ್‌ಗಳು</Text>
        <View style={s.infoCard}>
          <InfoRow icon="language-outline" label="Language" value="English + ಕನ್ನಡ" />
          <View style={s.divider} />
          <InfoRow icon="notifications-outline" label="Notifications" value="On" />
        </View>

        {/* Legal — Play Store also reads the Privacy Policy URL from
            the app listing, but making it visible in-app is required. */}
        <Text style={s.sectionLabel}>Legal · ಕಾನೂನು</Text>
        <View style={s.infoCard}>
          <TouchableOpacity onPress={() => router.push('/legal/terms')}>
            <InfoRow icon="document-text-outline" label="Terms of Service" value="Read" />
          </TouchableOpacity>
          <View style={s.divider} />
          <TouchableOpacity onPress={() => router.push('/legal/privacy')}>
            <InfoRow icon="shield-checkmark-outline" label="Privacy Policy" value="Read" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.signOutBtn} onPress={signOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={16} color={COLORS.accentRed} />
          <Text style={s.signOutText}>Sign out · ಸೈನ್ ಔಟ್</Text>
        </TouchableOpacity>

        {/* Delete account — Play Store 2024+ policy requires an in-app path
            that fully removes account + data. Typed-out double confirm. */}
        <TouchableOpacity
          style={[s.signOutBtn, { backgroundColor: '#FEE2E2', marginTop: 10 }]}
          activeOpacity={0.8}
          onPress={() => {
            Alert.alert(
              'Delete your account?',
              'This will permanently remove your buyer profile, all offers you made, and your notification history. This cannot be undone.\n\nಶಾಶ್ವತವಾಗಿ ಎಲ್ಲಾ ಡೇಟಾ ಅಳಿಸಲಾಗುತ್ತದೆ.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete forever',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const { deleteMyBuyerAccount } = await import('../../lib/api');
                      await deleteMyBuyerAccount();
                      await auth.signOut();
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
          <Text style={[s.signOutText, { color: '#B91C1C' }]}>Delete my account</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatLine({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={s.statLine}>
      <View style={s.statIconBox}><Ionicons name={icon} size={14} color={COLORS.primary} /></View>
      <Text style={s.statLineLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={s.statLineValue}>{value}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <View style={s.infoIcon}><Ionicons name={icon} size={14} color={COLORS.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.lg, paddingBottom: 100 },

  identity: { alignItems: 'center', paddingTop: SPACING.lg, paddingBottom: SPACING.xl },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primaryLightBg,
            alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.primary },
  avatarText: { fontSize: 28, fontWeight: '800', color: COLORS.primaryDark },
  name: { fontSize: 18, fontWeight: '800', color: COLORS.textDark, marginTop: 10 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primaryLightBg,
               paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill, marginTop: 6 },
  roleText: { fontSize: 10, fontWeight: '700', color: COLORS.primary },

  sectionLabel: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  marginTop: SPACING.lg, marginBottom: SPACING.sm },

  statsCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  statLine: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md },
  statIconBox: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primaryLightBg,
                 alignItems: 'center', justifyContent: 'center' },
  statLineLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  statLineValue: { fontSize: 14, fontWeight: '800', color: COLORS.textDark },

  emptyStats: { padding: SPACING.lg, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
                borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  emptyStatsText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  infoCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md },
  infoIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primaryLightBg,
              alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '700' },
  infoValue: { fontSize: 13, fontWeight: '700', color: COLORS.textDark, marginTop: 1 },
  divider: { height: 1, backgroundColor: COLORS.borderLight, marginLeft: 46 },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                marginTop: SPACING.xl, paddingVertical: 12, borderRadius: RADII.pill,
                backgroundColor: COLORS.accentRedBg, borderWidth: 1, borderColor: '#FCA5A5' },
  signOutText: { fontSize: 13, fontWeight: '800', color: COLORS.accentRed },
});
