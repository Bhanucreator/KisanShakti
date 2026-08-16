import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../../constants/theme';

export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>Shop Profile</Text>
          <Text style={styles.subtitle}>ಶೋಪ್ ಪ್ರೊಫೈಲ್</Text>
        </View>

        {/* ── Shop Profile Banner Card ── */}
        <View style={styles.profileCard}>
          <View style={styles.storeIconBg}>
            <Ionicons name="storefront" size={32} color={COLORS.primaryDark} />
          </View>

          <View style={styles.nameVerifiedRow}>
            <Text style={styles.shopName}>Anil Kirana Store</Text>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.primaryDark} />
          </View>

          <View style={styles.locRow}>
            <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.locText}>MG Road, Kolar</Text>
          </View>

          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color="#F59E0B" />
            <Text style={styles.ratingVal}>4.7</Text>
            <Text style={styles.ratingSub}>· 132 orders</Text>
          </View>

          {/* 3 Metric Cards Row */}
          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricVal}>58</Text>
              <Text style={styles.metricLabel}>Farmers</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricVal}>₹1.4L</Text>
              <Text style={styles.metricLabel}>This Month</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricVal}>98%</Text>
              <Text style={styles.metricLabel}>On-time</Text>
            </View>
          </View>
        </View>

        {/* ── Settings Menu List ── */}
        <View style={styles.menuContainer}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Contact & Business Hours', 'Mon-Sat: 8 AM - 8 PM')}
            activeOpacity={0.7}
          >
            <Ionicons name="call-outline" size={20} color={COLORS.primary} />
            <Text style={styles.menuText}>Contact & Business Hours</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Notifications', 'Notification preferences')}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={20} color={COLORS.primary} />
            <Text style={styles.menuText}>Notifications</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('Language', 'Switched language')}
            activeOpacity={0.7}
          >
            <Ionicons name="language-outline" size={20} color={COLORS.primary} />
            <Text style={styles.menuText}>Language — English / ಕನ್ನಡ</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => Alert.alert('GST & FSSAI', 'Verified GSTIN: 29AAAAA0000A1Z5')}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} />
            <Text style={styles.menuText}>Verify GST & FSSAI</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        {/* ── Role Switch / Logout Button ── */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => Alert.alert('Switch Role / Logout', 'Logging out of Anil Kirana Store')}
          activeOpacity={0.8}
        >
          <Ionicons name="exit-outline" size={18} color={COLORS.accentRed} />
          <Text style={styles.logoutBtnText}>Switch role / Log out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 48 },

  header: { marginBottom: SPACING.lg },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  // Profile Card
  profileCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', marginBottom: SPACING.xl, ...SHADOWS.card,
  },
  storeIconBg: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, borderWidth: 2, borderColor: '#C8E6C9',
  },
  nameVerifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shopName: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locText: { fontSize: 12, color: COLORS.textMuted },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ratingVal: { fontSize: 13, fontWeight: '800', color: COLORS.textDark },
  ratingSub: { fontSize: 12, color: COLORS.textMuted },

  // Metrics
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: SPACING.xl, width: '100%' },
  metricCard: {
    flex: 1, backgroundColor: COLORS.bgSubtle, borderRadius: RADII.lg,
    padding: SPACING.md, alignItems: 'center',
  },
  metricVal: { fontSize: 16, fontWeight: '800', color: COLORS.primaryDark },
  metricLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },

  // Menu List
  menuContainer: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.xl, ...SHADOWS.card,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', padding: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderLight, gap: 12,
  },
  menuText: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textDark },

  // Logout
  logoutBtn: {
    backgroundColor: '#FEE2E2', borderRadius: RADII.pill,
    paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderColor: '#FECACA',
  },
  logoutBtnText: { color: COLORS.accentRed, fontWeight: '700', fontSize: 14 },
});
