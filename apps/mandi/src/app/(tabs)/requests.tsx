import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../../constants/theme';
import { router } from 'expo-router';

type BuyerRequest = {
  id: string;
  crop: string;
  farmer: string;
  status: 'PENDING' | 'COUNTERED' | 'ACCEPTED';
  yourOffer: number;
  farmerAsk: number;
  gap: number;
  timeAgo: string;
};

const MOCK_REQUESTS: BuyerRequest[] = [
  {
    id: '1', crop: '50 kg Tomato', farmer: 'from Raju S.',
    status: 'PENDING', yourOffer: 18, farmerAsk: 20, gap: 2,
    timeAgo: '5m ago',
  },
  {
    id: '2', crop: '30 kg Ragi', farmer: 'from Lakshmi P.',
    status: 'COUNTERED', yourOffer: 32, farmerAsk: 34, gap: 2,
    timeAgo: '1h ago',
  },
];

export default function RequestsScreen() {
  const [activeTab, setActiveTab] = useState<'Sent' | 'Received' | 'Negotiating'>('Sent');

  const renderItem = ({ item }: { item: BuyerRequest }) => (
    <View style={styles.requestCard}>
      {/* Top Header */}
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cropTitle}>{item.crop}</Text>
          <Text style={styles.farmerSub}>{item.farmer}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          item.status === 'PENDING' && { backgroundColor: '#FEF3C7' },
          item.status === 'COUNTERED' && { backgroundColor: '#FEE2E2' },
          item.status === 'ACCEPTED' && { backgroundColor: '#E8F5E9' },
        ]}>
          <Text style={[
            styles.statusText,
            item.status === 'PENDING' && { color: COLORS.accentAmber },
            item.status === 'COUNTERED' && { color: COLORS.accentRed },
            item.status === 'ACCEPTED' && { color: COLORS.primaryDark },
          ]}>
            {item.status}
          </Text>
        </View>
      </View>

      {/* 3 Metric Blocks Row */}
      <View style={styles.metricsRow}>
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>Your Offer</Text>
          <Text style={[styles.metricVal, { color: COLORS.primaryDark }]}>₹{item.yourOffer}</Text>
        </View>
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>Farmer Ask</Text>
          <Text style={styles.metricVal}>₹{item.farmerAsk}</Text>
        </View>
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>Gap</Text>
          <Text style={[styles.metricVal, { color: COLORS.accentRed }]}>₹{item.gap}</Text>
        </View>
      </View>

      {/* Bottom Footer & Action Circles */}
      <View style={styles.cardFooter}>
        <View style={styles.timeRow}>
          <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.timeText}>{item.timeAgo}</Text>
        </View>

        <View style={styles.actionCirclesRow}>
          {/* Cancel Button */}
          <TouchableOpacity
            style={styles.cancelCircle}
            onPress={() => Alert.alert('Cancel Request', 'Are you sure you want to cancel?')}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={18} color={COLORS.accentRed} />
          </TouchableOpacity>

          {/* Chat Button */}
          <TouchableOpacity
            style={styles.chatCircle}
            onPress={() => router.push('/chat')}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.primaryDark} />
          </TouchableOpacity>

          {/* Accept Button */}
          <TouchableOpacity
            style={styles.acceptCircle}
            onPress={() => Alert.alert('Accepted ✅', `Offer of ₹${item.farmerAsk}/kg accepted.`)}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark" size={18} color={COLORS.textWhite} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top Header */}
      <View style={styles.header}>
        <Ionicons name="arrow-back" size={22} color={COLORS.textDark} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.title}>Buyer Requests</Text>
          <Text style={styles.subtitle}>ಖರೀದಿದಾರರ ವಿನಂತಿಗಳು</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity activeOpacity={0.7}>
            <Ionicons name="share-social-outline" size={20} color={COLORS.textDark} />
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7}>
            <Ionicons name="heart-outline" size={20} color={COLORS.textDark} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Segmented Controls */}
      <View style={styles.segContainer}>
        {(['Sent', 'Received', 'Negotiating'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.segBtn, activeTab === tab && styles.segBtnActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segBtnText, activeTab === tab && styles.segBtnTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={MOCK_REQUESTS}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },

  // Segmented Controls
  segContainer: {
    flexDirection: 'row', backgroundColor: COLORS.bgSubtle,
    borderRadius: RADII.pill, padding: 4, marginHorizontal: SPACING.xl, marginBottom: SPACING.lg,
  },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: RADII.pill, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.primaryDark },
  segBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  segBtnTextActive: { color: COLORS.textWhite, fontWeight: '700' },

  list: { paddingHorizontal: SPACING.xl, paddingBottom: 40 },

  // Request Card
  requestCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.md, ...SHADOWS.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md },
  cropTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  farmerSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADII.pill },
  statusText: { fontSize: 10, fontWeight: '800' },

  // 3 Metric Blocks
  metricsRow: {
    flexDirection: 'row', backgroundColor: COLORS.bgSubtle,
    borderRadius: RADII.lg, padding: SPACING.md, gap: 8, marginBottom: SPACING.md,
  },
  metricBlock: { flex: 1, alignItems: 'center' },
  metricLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  metricVal: { fontSize: 16, fontWeight: '800', marginTop: 2 },

  // Footer & Action Circles
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  actionCirclesRow: { flexDirection: 'row', gap: 10 },
  cancelCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center',
  },
  chatCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9',
    alignItems: 'center', justifyContent: 'center',
  },
  acceptCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primaryDark, alignItems: 'center', justifyContent: 'center',
  },
});
