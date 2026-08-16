import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Linking, Alert, TextInput, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../../constants/theme';
import { router } from 'expo-router';

type Listing = {
  id: string;
  cropName: string;
  cropKn: string;
  grade: string;
  farmerName: string;
  rating: number;
  timeStr: string;
  locationDist: string;
  pricePerKg: number;
  originalPrice: number;
  qtyKg: number;
  phone: string;
  imageUrl: string;
};

const CATEGORIES = ['All', 'Vegetables', 'Grains', 'Fruits', 'Dairy'];

const MOCK_FARMER_LISTINGS: Listing[] = [
  {
    id: '1',
    cropName: '50 kg Tomato',
    cropKn: 'ಟೊಮೇಟೊ',
    grade: 'Grade A',
    farmerName: 'Raju S.',
    rating: 4.6,
    timeStr: 'Today',
    locationDist: 'Kolar · 1.2 km',
    pricePerKg: 20,
    originalPrice: 24,
    qtyKg: 50,
    phone: '+91 98450 12345',
    imageUrl: 'https://images.unsplash.com/photo-1592417817098-8f3d6ef23a23?w=300&q=80',
  },
  {
    id: '2',
    cropName: '30 kg Ragi',
    cropKn: 'ರಾಗಿ',
    grade: 'Grade A+',
    farmerName: 'Lakshmi P.',
    rating: 4.9,
    timeStr: '2 days ago',
    locationDist: 'Malur · 3.4 km',
    pricePerKg: 34,
    originalPrice: 38,
    qtyKg: 30,
    phone: '+91 87654 32109',
    imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300&q=80',
  },
];

export default function DiscoverScreen() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery]       = useState('');
  const [buyer]                              = useState({ name: 'Anil', location: 'MG Road, Kolar' });

  const callFarmer = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Error', 'Unable to place call'));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Top Header ── */}
        <View style={styles.header}>
          <View>
            <View style={styles.nameRow}>
              <Text style={styles.greeting}>Namaskara, {buyer.name}</Text>
              <Text style={styles.handEmoji}>👋</Text>
            </View>
            <View style={styles.locationRow}>
              <Ionicons name="location-sharp" size={13} color={COLORS.primary} />
              <Text style={styles.locationText}>{buyer.location}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.bellBtn} activeOpacity={0.7}>
            <Ionicons name="notifications-outline" size={22} color={COLORS.textDark} />
            <View style={styles.bellBadge} />
          </TouchableOpacity>
        </View>

        {/* ── Search Bar & Filter ── */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search crop, farmer, village..."
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity style={styles.filterBtn} activeOpacity={0.8}>
            <Ionicons name="options-outline" size={20} color={COLORS.textWhite} />
          </TouchableOpacity>
        </View>

        {/* ── Category Chips ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.catChip, activeCategory === cat && styles.catChipActive]}
              onPress={() => setActiveCategory(cat)}
              activeOpacity={0.7}
            >
              <Text style={[styles.catText, activeCategory === cat && styles.catTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Weather & Market Summary Card ── */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryLeft}>
            <Ionicons name="sunny" size={24} color="#F59E0B" />
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.summaryTemp}>28°c</Text>
              <Text style={styles.summaryCond}>Partly Cloudy</Text>
            </View>
          </View>
          <View style={styles.summaryRight}>
            <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.summaryLoc}>Kolar Today</Text>
          </View>
        </View>

        {/* ── Top Metric Cards Row ── */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={[styles.metricVal, { color: COLORS.primaryDark }]}>24</Text>
            <Text style={styles.metricLabel}>Nearby Farmers</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricVal, { color: COLORS.primaryDark }]}>58</Text>
            <Text style={styles.metricLabel}>Active Listings</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={[styles.metricVal, { color: COLORS.accentRed }]}>-8% 📉</Text>
            <Text style={styles.metricLabel}>vs Mandi Rate</Text>
          </View>
        </View>

        {/* ── Farmer Listings Near You Section ── */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="filter" size={16} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Farmer Listings Near You</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.viewAllText}>View all</Text>
          </TouchableOpacity>
        </View>

        {/* ── Listings Cards ── */}
        {MOCK_FARMER_LISTINGS.map((item) => (
          <View key={item.id} style={styles.listingCard}>
            {/* Top row with image & details */}
            <View style={styles.listingTop}>
              <Image source={{ uri: item.imageUrl }} style={styles.cropImg} />
              <View style={{ flex: 1 }}>
                <View style={styles.cropTitleRow}>
                  <View>
                    <Text style={styles.cropTitle}>{item.cropName}</Text>
                    <Text style={styles.cropKn}>{item.cropKn}</Text>
                  </View>
                  <View style={styles.gradeBadge}>
                    <Text style={styles.gradeText}>{item.grade}</Text>
                  </View>
                </View>

                {/* Farmer Info */}
                <View style={styles.farmerInfoRow}>
                  <Text style={styles.farmerName}>{item.farmerName}</Text>
                  <Text style={styles.dotSep}>·</Text>
                  <Ionicons name="star" size={12} color="#F59E0B" />
                  <Text style={styles.ratingText}>{item.rating}</Text>
                  <Text style={styles.dotSep}>·</Text>
                  <Text style={styles.timeText}>{item.timeStr}</Text>
                </View>

                <View style={styles.locationDistRow}>
                  <Ionicons name="location-outline" size={12} color={COLORS.textMuted} />
                  <Text style={styles.locationDistText}>{item.locationDist}</Text>
                </View>

                {/* Price */}
                <View style={styles.priceRow}>
                  <Text style={styles.pricePerKg}>₹{item.pricePerKg}/kg</Text>
                  <Text style={styles.originalPrice}>₹{item.originalPrice}</Text>
                </View>
              </View>
            </View>

            {/* Phone Call Bar */}
            <View style={styles.callBar}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="call-outline" size={16} color={COLORS.primaryDark} />
                <Text style={styles.phoneText}>{item.phone}</Text>
              </View>
              <TouchableOpacity
                style={styles.callSmallBtn}
                onPress={() => callFarmer(item.phone)}
                activeOpacity={0.8}
              >
                <Text style={styles.callSmallBtnText}>Call</Text>
              </TouchableOpacity>
            </View>

            {/* Action Buttons */}
            <View style={styles.actionBtnRow}>
              <TouchableOpacity
                style={styles.negotiateBtn}
                onPress={() => router.push('/chat')}
                activeOpacity={0.8}
              >
                <Text style={styles.negotiateBtnText}>Negotiate</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.requestQuoteBtn}
                onPress={() => Alert.alert('Request Sent', `Quote request sent to ${item.farmerName}`)}
                activeOpacity={0.8}
              >
                <Text style={styles.requestQuoteBtnText}>Request Quote</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 48 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  greeting: { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  handEmoji: { fontSize: 20 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locationText: { fontSize: 13, color: COLORS.textMuted },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center', ...SHADOWS.card,
  },
  bellBadge: {
    position: 'absolute', top: 10, right: 10,
    width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accentRed,
  },

  // Search
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.md },
  searchBox: {
    flex: 1, backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADII.pill, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 13, color: COLORS.textDark },
  filterBtn: {
    width: 46, height: 46, borderRadius: RADII.md,
    backgroundColor: COLORS.primaryDark, justifyContent: 'center', alignItems: 'center',
    ...SHADOWS.card,
  },

  // Category chips
  catScroll: { marginBottom: SPACING.lg },
  catChip: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.pill,
    paddingHorizontal: 16, paddingVertical: 8, marginRight: 8, backgroundColor: COLORS.bgCard,
  },
  catChipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  catText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  catTextActive: { color: COLORS.textWhite, fontWeight: '700' },

  // Summary Card
  summaryCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.md, ...SHADOWS.card,
  },
  summaryLeft: { flexDirection: 'row', alignItems: 'center' },
  summaryTemp: { fontSize: 18, fontWeight: '800', color: COLORS.textDark },
  summaryCond: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  summaryRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryLoc: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },

  // Metrics
  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.xl },
  metricCard: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', ...SHADOWS.card,
  },
  metricVal: { fontSize: 18, fontWeight: '800' },
  metricLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },

  // Section
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  viewAllText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Listing Cards
  listingCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.lg, ...SHADOWS.card,
  },
  listingTop: { flexDirection: 'row', gap: 12, marginBottom: SPACING.md },
  cropImg: { width: 84, height: 84, borderRadius: RADII.md },
  cropTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cropTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  cropKn: { fontSize: 11, color: COLORS.textMuted },
  gradeBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.pill },
  gradeText: { fontSize: 10, fontWeight: '700', color: COLORS.primaryDark },

  farmerInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  farmerName: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  dotSep: { color: COLORS.textMuted, fontSize: 12 },
  ratingText: { fontSize: 11, fontWeight: '700', color: COLORS.textDark },
  timeText: { fontSize: 11, color: COLORS.textMuted },

  locationDistRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  locationDistText: { fontSize: 11, color: COLORS.textMuted },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 },
  pricePerKg: { fontSize: 18, fontWeight: '800', color: COLORS.primaryDark },
  originalPrice: { fontSize: 13, color: COLORS.textMuted, textDecorationLine: 'line-through' },

  // Call Bar
  callBar: {
    backgroundColor: COLORS.bgSubtle, borderRadius: RADII.lg,
    paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.md,
  },
  phoneText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  callSmallBtn: { backgroundColor: '#E8F5E9', paddingHorizontal: 16, paddingVertical: 6, borderRadius: RADII.pill },
  callSmallBtnText: { color: COLORS.primaryDark, fontWeight: '700', fontSize: 12 },

  // Action Row
  actionBtnRow: { flexDirection: 'row', gap: 10 },
  negotiateBtn: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.pill,
    paddingVertical: 12, borderWidth: 1.5, borderColor: COLORS.primaryDark,
    alignItems: 'center',
  },
  negotiateBtnText: { color: COLORS.primaryDark, fontWeight: '700', fontSize: 14 },
  requestQuoteBtn: {
    flex: 1, backgroundColor: COLORS.primaryDark, borderRadius: RADII.pill,
    paddingVertical: 12, alignItems: 'center',
  },
  requestQuoteBtnText: { color: COLORS.textWhite, fontWeight: '700', fontSize: 14 },
});
