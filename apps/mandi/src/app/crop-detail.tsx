import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, Linking, Alert, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../constants/theme';
import { router } from 'expo-router';

const { width } = Dimensions.get('window');

export default function CropDetailScreen() {
  const crop = {
    title: '50 kg Tomato',
    titleKn: 'ಟೊಮೇಟೊ',
    grade: 'Grade A',
    farmerName: 'Raju S.',
    rating: 4.6,
    listingsCount: 20,
    locationDist: 'Kolar · 1.2 km',
    pricePerKg: 20,
    originalPrice: 24,
    phone: '+91 98450 12345',
    imageUrl: 'https://images.unsplash.com/photo-1592417817098-8f3d6ef23a23?w=800&q=80',
    variety: 'NATI',
    harvested: 'Today',
    quality: 'Excellent',
    pesticide: 'Low',
  };

  const callFarmer = () => {
    Linking.openURL(`tel:${crop.phone}`).catch(() => Alert.alert('Error', 'Unable to place call'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgApp }}>
      {/* ── Hero Image Banner ── */}
      <View style={styles.heroImageContainer}>
        <Image source={{ uri: crop.imageUrl }} style={styles.heroImage} />
        <SafeAreaView style={styles.heroNavRow}>
          <TouchableOpacity style={styles.navCircle} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={20} color={COLORS.textDark} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={styles.navCircle} activeOpacity={0.8}>
              <Ionicons name="share-social-outline" size={20} color={COLORS.textDark} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navCircle} activeOpacity={0.8}>
              <Ionicons name="heart-outline" size={20} color={COLORS.textDark} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Main Crop Details Card ── */}
        <View style={styles.detailsCard}>
          <View style={styles.titleGradeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cropTitle}>{crop.title}</Text>
              <Text style={styles.cropKn}>{crop.titleKn}</Text>
            </View>
            <View style={styles.gradeBadge}>
              <Text style={styles.gradeText}>{crop.grade}</Text>
            </View>
          </View>

          {/* Farmer Sub Row */}
          <View style={styles.farmerSubRow}>
            <Text style={styles.farmerName}>{crop.farmerName}</Text>
            <Text style={styles.dotSep}>·</Text>
            <Ionicons name="star" size={13} color="#F59E0B" />
            <Text style={styles.ratingText}>{crop.rating}</Text>
            <Text style={styles.dotSep}>·</Text>
            <Text style={styles.listingsText}>{crop.listingsCount} Listings</Text>
          </View>

          <View style={styles.locRow}>
            <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.locText}>{crop.locationDist}</Text>
          </View>

          {/* Price */}
          <View style={styles.priceRow}>
            <Text style={styles.pricePerKg}>₹{crop.pricePerKg}/kg</Text>
            <Text style={styles.originalPrice}>₹{crop.originalPrice}</Text>
          </View>

          {/* ── About this produce Grid ── */}
          <Text style={styles.sectionHeader}>About this produce</Text>
          <View style={styles.specsGrid}>
            <View style={styles.specCard}>
              <Text style={styles.specLabel}>Variety</Text>
              <Text style={styles.specVal}>{crop.variety}</Text>
            </View>
            <View style={styles.specCard}>
              <Text style={styles.specLabel}>Harvested</Text>
              <Text style={styles.specVal}>{crop.harvested}</Text>
            </View>
            <View style={styles.specCard}>
              <Text style={styles.specLabel}>Quality</Text>
              <Text style={styles.specVal}>{crop.quality}</Text>
            </View>
            <View style={styles.specCard}>
              <Text style={styles.specLabel}>Pesticide</Text>
              <Text style={styles.specVal}>{crop.pesticide}</Text>
            </View>
          </View>

          {/* ── Farmer Details ── */}
          <Text style={styles.sectionHeader}>Farmer details</Text>
          <View style={styles.farmerCard}>
            <View style={styles.farmerAvatarBg}>
              <Ionicons name="person" size={20} color={COLORS.primaryDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.farmerCardName}>{crop.farmerName}</Text>
              <Text style={styles.verifiedTag}>Verified Farmer</Text>
            </View>
            <TouchableOpacity style={styles.callCircleBtn} onPress={callFarmer} activeOpacity={0.8}>
              <Ionicons name="call-outline" size={18} color={COLORS.primaryDark} />
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* ── Bottom Action Buttons Bar ── */}
      <SafeAreaView style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.negotiateBtn}
          onPress={() => router.push('/chat')}
          activeOpacity={0.8}
        >
          <Text style={styles.negotiateBtnText}>Negotiate</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.requestQuoteBtn}
          onPress={() => Alert.alert('Quote Requested', `Quote request sent to ${crop.farmerName}`)}
          activeOpacity={0.8}
        >
          <Text style={styles.requestQuoteBtnText}>Request Quote</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroImageContainer: { height: 260, width: '100%', position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroNavRow: {
    position: 'absolute', top: 12, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  navCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
    ...SHADOWS.card,
  },

  scroll: { padding: SPACING.xl, paddingBottom: 100, marginTop: -24 },

  // Details Card
  detailsCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  titleGradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cropTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  cropKn: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  gradeBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill },
  gradeText: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },

  farmerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  farmerName: { fontSize: 13, fontWeight: '700', color: COLORS.textDark },
  dotSep: { color: COLORS.textMuted, fontSize: 12 },
  ratingText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  listingsText: { fontSize: 12, color: COLORS.textMuted },

  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locText: { fontSize: 12, color: COLORS.textMuted },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 14, marginBottom: SPACING.lg },
  pricePerKg: { fontSize: 24, fontWeight: '800', color: COLORS.primaryDark },
  originalPrice: { fontSize: 15, color: COLORS.textMuted, textDecorationLine: 'line-through' },

  // About produce
  sectionHeader: { fontSize: 14, fontWeight: '700', color: COLORS.textDark, marginTop: SPACING.md, marginBottom: SPACING.sm },
  specsGrid: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  specCard: {
    flex: 1, backgroundColor: COLORS.bgSubtle, borderRadius: RADII.md,
    padding: SPACING.sm, alignItems: 'center',
  },
  specLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  specVal: { fontSize: 11, fontWeight: '800', color: COLORS.textDark, marginTop: 2 },

  // Farmer Details
  farmerCard: {
    backgroundColor: COLORS.bgSubtle, borderRadius: RADII.lg,
    padding: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  farmerAvatarBg: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' },
  farmerCardName: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  verifiedTag: { fontSize: 10, color: COLORS.primary, fontWeight: '600', marginTop: 1 },
  callCircleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' },

  // Bottom Bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: COLORS.bgCard, borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.xl, paddingVertical: 12, flexDirection: 'row', gap: 12,
    ...SHADOWS.card,
  },
  negotiateBtn: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.pill,
    paddingVertical: 14, borderWidth: 1.5, borderColor: COLORS.primaryDark,
    alignItems: 'center',
  },
  negotiateBtnText: { color: COLORS.primaryDark, fontWeight: '700', fontSize: 15 },
  requestQuoteBtn: {
    flex: 1, backgroundColor: COLORS.primaryDark, borderRadius: RADII.pill,
    paddingVertical: 14, alignItems: 'center',
  },
  requestQuoteBtnText: { color: COLORS.textWhite, fontWeight: '700', fontSize: 15 },
});
