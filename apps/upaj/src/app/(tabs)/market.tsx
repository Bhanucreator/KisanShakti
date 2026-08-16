/**
 * Market Screen — Hyperlocal produce marketplace.
 * Wired to real backend: smart pricing, crop listings, nearby buyers.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import type { CropListing } from '../../../../../shared/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

const KOLAR_LAT = 13.1367;
const KOLAR_LON = 78.1325;

const CROP_OPTIONS = ['Tomato', 'Potato', 'Onion', 'Ragi', 'Maize', 'Beans'] as const;
const GRADE_OPTIONS = ['A', 'B', 'C'] as const;

type CropOption  = typeof CROP_OPTIONS[number];
type GradeOption = typeof GRADE_OPTIONS[number];
type ActiveTab   = 'sell' | 'active' | 'orders';
type MarketState = 'idle' | 'fetching_price' | 'submitting' | 'success' | 'error';

// Grade A = 0 modifier shown, B = -2, C = -4 (the API value is integer %)
const GRADE_DEFAULT_MODIFIER: Record<GradeOption, number> = { A: 0, B: -2, C: -4 };

// ─── API helpers ─────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SkeletonBox({ width, height, style }: { width: number | string; height: number; style?: object }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius: RADII.sm, backgroundColor: '#E5E7EB', opacity }, style]}
    />
  );
}

function PriceCardSkeleton() {
  return (
    <View style={styles.priceSuggestedCard}>
      <SkeletonBox width={140} height={12} style={{ marginBottom: 10 }} />
      <SkeletonBox width={100} height={28} style={{ marginBottom: 8 }} />
      <SkeletonBox width={180} height={10} />
    </View>
  );
}

function BuyerCardSkeleton() {
  return (
    <View style={styles.buyerCard}>
      <View style={[styles.buyerIconBg, { backgroundColor: '#E5E7EB' }]} />
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBox width={120} height={12} />
        <SkeletonBox width={160} height={10} />
      </View>
      <SkeletonBox width={40} height={10} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function MarketScreen() {
  // Tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('sell');

  // Form
  const [crop, setCrop]         = useState<CropOption>('Tomato');
  const [quantity, setQuantity] = useState('50');
  const [grade, setGrade]       = useState<GradeOption>('A');
  const [qualityModifier, setQualityModifier] = useState<number>(0); // -5 to +5

  // Crop picker modal state (inline list)
  const [showCropPicker, setShowCropPicker]   = useState(false);
  const [showGradePicker, setShowGradePicker] = useState(false);

  // Smart price
  const [smartPrice, setSmartPrice] = useState<number | null>(null);
  const [priceState, setPriceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // Listings
  const [listings, setListings]           = useState<CropListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);

  // Nearby buyers
  const [nearbyListings, setNearbyListings]       = useState<CropListing[]>([]);
  const [nearbyLoading, setNearbyLoading]         = useState(false);

  // Submit
  const [marketState, setMarketState] = useState<MarketState>('idle');
  const [showSuccess, setShowSuccess] = useState(false);
  const successOpacity = useRef(new Animated.Value(0)).current;

  // ── Fetch smart price whenever crop or modifier changes ────────────────────
  const fetchSmartPrice = useCallback(async (cropName: string, modifier: number) => {
    setPriceState('loading');
    setSmartPrice(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/v1/pricing/smart-price?crop_name=${encodeURIComponent(cropName)}&quality_modifier=${modifier}`,
        { method: 'POST', headers },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { crop_name: string; smart_price: number } = await res.json();
      setSmartPrice(data.smart_price);
      setPriceState('ready');
    } catch (err) {
      console.warn('[Market] smart-price fetch failed, using fallback', err);
      // Fallback: simple static prices per crop
      const fallbacks: Record<string, number> = {
        Tomato: 20, Potato: 15, Onion: 18, Ragi: 25, Maize: 12, Beans: 30,
      };
      const base = fallbacks[cropName] ?? 20;
      setSmartPrice(parseFloat((base * (1 + modifier / 100)).toFixed(2)));
      setPriceState('ready');
    }
  }, []);

  useEffect(() => {
    fetchSmartPrice(crop, qualityModifier);
  }, [crop, qualityModifier, fetchSmartPrice]);

  // ── Fetch nearby listings (buyer cards) ───────────────────────────────────
  const fetchNearbyListings = useCallback(async () => {
    setNearbyLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/v1/crops/nearby?latitude=${KOLAR_LAT}&longitude=${KOLAR_LON}&radius_km=25`,
        { headers },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CropListing[] = await res.json();
      setNearbyListings(data);
    } catch (err) {
      console.warn('[Market] nearby fetch failed', err);
      setNearbyListings([]);
    } finally {
      setNearbyLoading(false);
    }
  }, []);

  // ── Fetch farmer's own listings ───────────────────────────────────────────
  const fetchMyListings = useCallback(async () => {
    setListingsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/v1/crops/listing`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CropListing[] = await res.json();
      setListings(data);
    } catch (err) {
      console.warn('[Market] my-listings fetch failed', err);
      // Fallback mock
      setListings([
        { id: 'm1', farmer_id: 'me', crop_name: 'Tomato', quantity_kg: 50, calculated_price_per_kg: 20, status: 'AVAILABLE' },
        { id: 'm2', farmer_id: 'me', crop_name: 'Ragi', quantity_kg: 30, calculated_price_per_kg: 25, status: 'LOCKED' },
      ]);
    } finally {
      setListingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNearbyListings();
  }, [fetchNearbyListings]);

  useEffect(() => {
    if (activeTab === 'active') fetchMyListings();
  }, [activeTab, fetchMyListings]);

  // ── Grade change resets modifier to grade default ─────────────────────────
  const handleGradeChange = (g: GradeOption) => {
    setGrade(g);
    setQualityModifier(GRADE_DEFAULT_MODIFIER[g]);
    setShowGradePicker(false);
  };

  // ── Quality modifier buttons ──────────────────────────────────────────────
  const decrementModifier = () => setQualityModifier(m => Math.max(-5, m - 1));
  const incrementModifier = () => setQualityModifier(m => Math.min(5, m + 1));

  // ── Compute displayed price (base smart price + modifier delta) ───────────
  const displayPrice: number | null = smartPrice != null
    ? parseFloat((smartPrice).toFixed(2)) // modifier already applied via API param
    : null;

  // ── Show success banner ───────────────────────────────────────────────────
  const triggerSuccessBanner = () => {
    setShowSuccess(true);
    Animated.sequence([
      Animated.timing(successOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(successOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setShowSuccess(false));
  };

  // ── Submit listing ────────────────────────────────────────────────────────
  const handlePostListing = async () => {
    const qty = parseFloat(quantity);
    if (!quantity.trim() || isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a valid quantity in kg.');
      return;
    }
    if (displayPrice == null) {
      Alert.alert('Price not ready', 'Please wait for price to load.');
      return;
    }

    setMarketState('submitting');
    try {
      const headers = await getAuthHeaders();
      const body = JSON.stringify({
        crop_name: crop,
        quantity_kg: qty,
        calculated_price_per_kg: displayPrice,
      });
      const res = await fetch(`${API_BASE}/api/v1/crops/listing`, {
        method: 'POST',
        headers,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMarketState('success');
      triggerSuccessBanner();
      // Reset form
      setQuantity('50');
      setGrade('A');
      setQualityModifier(0);
    } catch (err) {
      console.warn('[Market] post-listing failed', err);
      setMarketState('error');
      Alert.alert('Failed to post listing', 'Please check your connection and try again.');
      setMarketState('idle');
    } finally {
      // Return to idle after a beat so the button re-enables
      setTimeout(() => setMarketState('idle'), 2200);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const renderSellTab = () => (
    <>
      {/* Crop Selector */}
      <Text style={styles.label}>Crop</Text>
      <TouchableOpacity
        style={styles.dropdownInput}
        onPress={() => { setShowCropPicker(v => !v); setShowGradePicker(false); }}
        activeOpacity={0.7}
      >
        <Text style={styles.dropdownText}>{crop}</Text>
        <Ionicons name={showCropPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
      </TouchableOpacity>

      {showCropPicker && (
        <View style={styles.pickerList}>
          {CROP_OPTIONS.map(c => (
            <TouchableOpacity
              key={c}
              style={[styles.pickerItem, c === crop && styles.pickerItemActive]}
              onPress={() => { setCrop(c); setShowCropPicker(false); }}
            >
              <Text style={[styles.pickerItemText, c === crop && styles.pickerItemTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Quantity + Grade Row */}
      <View style={styles.rowInputs}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Quantity</Text>
          <View style={styles.inputWithUnit}>
            <TextInput
              style={styles.textInput}
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="0"
              placeholderTextColor={COLORS.textMuted}
            />
            <Text style={styles.unitTag}>kg</Text>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Grade</Text>
          <TouchableOpacity
            style={styles.dropdownInput}
            onPress={() => { setShowGradePicker(v => !v); setShowCropPicker(false); }}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownText}>Grade {grade}</Text>
            <Ionicons name={showGradePicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
          {showGradePicker && (
            <View style={[styles.pickerList, { position: 'absolute', top: 52, left: 0, right: 0, zIndex: 20 }]}>
              {GRADE_OPTIONS.map(g => (
                <TouchableOpacity
                  key={g}
                  style={[styles.pickerItem, g === grade && styles.pickerItemActive]}
                  onPress={() => handleGradeChange(g)}
                >
                  <Text style={[styles.pickerItemText, g === grade && styles.pickerItemTextActive]}>
                    Grade {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Fair Price Card */}
      {priceState === 'loading' ? (
        <PriceCardSkeleton />
      ) : (
        <View style={styles.priceSuggestedCard}>
          <Text style={styles.priceSuggestedHeader}>Fair Price (AI Smart Pricing)</Text>
          <View style={styles.priceValueRow}>
            {displayPrice != null ? (
              <Text style={styles.priceValueText}>
                ₹{displayPrice.toFixed(2)}
              </Text>
            ) : (
              <Text style={[styles.priceValueText, { color: COLORS.textMuted }]}>—</Text>
            )}
            <Text style={styles.perKgText}> / kg</Text>
          </View>
          <Text style={styles.priceSubText}>Based on market data + quality grade</Text>

          {/* Quality Modifier */}
          <View style={styles.qualityRow}>
            <Text style={styles.qualityLabel}>Quality adjustment:</Text>
            <View style={styles.qualityControls}>
              <TouchableOpacity style={styles.modBtn} onPress={decrementModifier} activeOpacity={0.7}>
                <Ionicons name="remove" size={16} color={COLORS.primaryDark} />
              </TouchableOpacity>
              <View style={styles.modValueBadge}>
                <Text style={styles.modValueText}>
                  {qualityModifier > 0 ? '+' : ''}{qualityModifier}%
                </Text>
              </View>
              <TouchableOpacity style={styles.modBtn} onPress={incrementModifier} activeOpacity={0.7}>
                <Ionicons name="add" size={16} color={COLORS.primaryDark} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Post Listing Button */}
      <TouchableOpacity
        style={[styles.postListingBtn, marketState === 'submitting' && styles.postListingBtnDisabled]}
        onPress={handlePostListing}
        activeOpacity={0.8}
        disabled={marketState === 'submitting' || priceState === 'loading'}
      >
        {marketState === 'submitting' ? (
          <ActivityIndicator size="small" color={COLORS.textWhite} />
        ) : (
          <>
            <Ionicons name="storefront-outline" size={18} color={COLORS.textWhite} />
            <Text style={styles.postListingText}>Post Listing</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Nearby Buyers Section */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Nearby Buyers</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={fetchNearbyListings}>
          <Text style={styles.viewMapText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {nearbyLoading ? (
        <>
          <BuyerCardSkeleton />
          <BuyerCardSkeleton />
          <BuyerCardSkeleton />
        </>
      ) : nearbyListings.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={36} color={COLORS.textMuted} />
          <Text style={styles.emptyStateText}>No nearby buyers found within 25 km.</Text>
          <Text style={styles.emptyStateSubText}>Try again after posting your listing.</Text>
        </View>
      ) : (
        nearbyListings.map((listing) => (
          <View key={listing.id} style={styles.buyerCard}>
            <View style={styles.buyerIconBg}>
              <Ionicons name="storefront-outline" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.buyerName}>{listing.farmer_name ?? 'Buyer'}</Text>
              <Text style={styles.buyerType}>
                {listing.crop_name} · {listing.quantity_kg} kg @ ₹{listing.calculated_price_per_kg}/kg
              </Text>
            </View>
            {listing.distance_km != null && (
              <Text style={styles.buyerDist}>{listing.distance_km.toFixed(1)} km</Text>
            )}
          </View>
        ))
      )}
    </>
  );

  const renderActiveListingsTab = () => (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>My Active Listings</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={fetchMyListings}>
          <Text style={styles.viewMapText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {listingsLoading ? (
        <>
          <BuyerCardSkeleton />
          <BuyerCardSkeleton />
        </>
      ) : listings.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="package" size={36} color={COLORS.textMuted} />
          <Text style={styles.emptyStateText}>No active listings yet.</Text>
          <Text style={styles.emptyStateSubText}>Post a listing in the Sell Produce tab.</Text>
        </View>
      ) : (
        listings.map((listing) => (
          <View key={listing.id} style={styles.listingCard}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.listingCropName}>{listing.crop_name}</Text>
                <View style={[styles.statusPill, { backgroundColor: listing.status === 'AVAILABLE' ? '#DCFCE7' : listing.status === 'LOCKED' ? '#FEF3C7' : '#FEE2E2' }]}>
                  <Text style={[styles.statusPillText, { color: listing.status === 'AVAILABLE' ? '#166534' : listing.status === 'LOCKED' ? '#D97706' : '#991B1B' }]}>
                    {listing.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.listingMeta}>
                {listing.quantity_kg} kg · ₹{listing.calculated_price_per_kg}/kg
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </View>
        ))
      )}
    </>
  );

  const renderOrdersTab = () => (
    <View style={styles.emptyState}>
      <Ionicons name="receipt-outline" size={40} color={COLORS.textMuted} />
      <Text style={styles.emptyStateText}>No orders yet.</Text>
      <Text style={styles.emptyStateSubText}>Orders from buyers will appear here.</Text>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      {/* Success Banner */}
      {showSuccess && (
        <Animated.View style={[styles.successBanner, { opacity: successOpacity }]}>
          <Ionicons name="checkmark-circle" size={20} color="#fff" />
          <Text style={styles.successBannerText}>Listing Posted! Buyers notified.</Text>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Hyperlocal Market</Text>
            <Text style={styles.subtitle}>Sell directly. Earn more.</Text>
          </View>
          <View style={styles.locationPill}>
            <Ionicons name="location-outline" size={12} color={COLORS.primary} />
            <Text style={styles.locationText}>Kolar</Text>
          </View>
        </View>

        {/* Segmented Tab Controls */}
        <View style={styles.segContainer}>
          {(['sell', 'active', 'orders'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.segBtn, activeTab === tab && styles.segBtnActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.segBtnText, activeTab === tab && styles.segBtnTextActive]}>
                {tab === 'sell' ? 'Sell Produce' : tab === 'active' ? 'My Listings' : 'Orders'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === 'sell'   && renderSellTab()}
        {activeTab === 'active' && renderActiveListingsTab()}
        {activeTab === 'orders' && renderOrdersTab()}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 64 },

  // Success banner
  successBanner: {
    position: 'absolute',
    top: 60,
    left: SPACING.xl,
    right: SPACING.xl,
    backgroundColor: COLORS.primaryDark,
    borderRadius: RADII.lg,
    paddingVertical: 14,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 999,
    ...SHADOWS.popover,
  },
  successBannerText: { color: COLORS.textWhite, fontWeight: '700', fontSize: 14, flex: 1 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.lg },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  locationPill: {
    backgroundColor: COLORS.primaryTint,
    borderRadius: RADII.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },

  // Segmented controls
  segContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgSubtle,
    borderRadius: RADII.pill,
    padding: 4,
    marginBottom: SPACING.xl,
  },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: RADII.pill, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.primaryDark },
  segBtnText: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted },
  segBtnTextActive: { color: COLORS.textWhite, fontWeight: '700' },

  // Form
  label: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginBottom: 6 },
  dropdownInput: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  dropdownText: { fontSize: 14, fontWeight: '600', color: COLORS.textDark },

  // Picker list
  pickerList: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 16 },
  pickerItemActive: { backgroundColor: COLORS.primaryTint },
  pickerItemText: { fontSize: 14, fontWeight: '600', color: COLORS.textDark },
  pickerItemTextActive: { color: COLORS.primaryDark, fontWeight: '700' },

  rowInputs: { flexDirection: 'row', gap: 12, marginBottom: SPACING.md, zIndex: 10 },
  inputWithUnit: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    paddingHorizontal: 14,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textInput: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.textDark, paddingVertical: 10 },
  unitTag: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },

  // Fair Price Card
  priceSuggestedCard: {
    backgroundColor: '#F4F9F5',
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    marginBottom: SPACING.lg,
  },
  priceSuggestedHeader: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600', marginBottom: 4 },
  priceValueRow: { flexDirection: 'row', alignItems: 'baseline', marginVertical: 4 },
  priceValueText: { fontSize: 26, fontWeight: '800', color: COLORS.primaryDark },
  perKgText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  priceSubText: { fontSize: 11, color: COLORS.primary, fontWeight: '500', marginBottom: 12 },

  // Quality modifier
  qualityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qualityLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  qualityControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modValueBadge: {
    backgroundColor: COLORS.primaryDark,
    borderRadius: RADII.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  modValueText: { fontSize: 13, fontWeight: '800', color: COLORS.textWhite, minWidth: 36, textAlign: 'center' },

  // Post listing button
  postListingBtn: {
    backgroundColor: COLORS.primaryDark,
    borderRadius: RADII.pill,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: SPACING.xxl,
    ...SHADOWS.card,
  },
  postListingBtnDisabled: { opacity: 0.7 },
  postListingText: { color: COLORS.textWhite, fontWeight: '800', fontSize: 15 },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  viewMapText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Buyer cards
  buyerCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADII.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    ...SHADOWS.card,
  },
  buyerIconBg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyerName: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  buyerType: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  buyerDist: { fontSize: 12, fontWeight: '600', color: COLORS.primary },

  // My listings
  listingCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADII.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    ...SHADOWS.card,
  },
  listingCropName: { fontSize: 15, fontWeight: '700', color: COLORS.textDark },
  listingMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 3 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.pill },
  statusPillText: { fontSize: 10, fontWeight: '800' },

  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xxxl,
    gap: 8,
  },
  emptyStateText: { fontSize: 15, fontWeight: '600', color: COLORS.textMuted },
  emptyStateSubText: { fontSize: 12, color: COLORS.textMuted },
});
