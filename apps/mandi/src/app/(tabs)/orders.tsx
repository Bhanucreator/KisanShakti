import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Linking, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS, FONT_SIZES } from '../../constants/theme';

type StepStatus = 'Confirmed' | 'Packed' | 'In Transit' | 'Delivered';

type OrderItem = {
  id: string;
  orderNo: string;
  crop: string;
  quantityKg: number;
  totalPrice: number;
  farmerName: string;
  farmerPhone: string;
  dateStr: string;
  currentStep: number; // 1 to 4
};

const MOCK_ORDERS: OrderItem[] = [
  {
    id: '1', orderNo: '#KS-2041', crop: '50 kg Tomato', quantityKg: 50,
    totalPrice: 900, farmerName: 'Raju S.', farmerPhone: '9876543210',
    dateStr: 'Today, 4:30 PM', currentStep: 4,
  },
  {
    id: '2', orderNo: '#KS-2038', crop: '30 kg Ragi', quantityKg: 30,
    totalPrice: 1020, farmerName: 'Lakshmi P.', farmerPhone: '8765432109',
    dateStr: 'Yesterday', currentStep: 3,
  },
  {
    id: '3', orderNo: '#KS-2044', crop: '120 kg Onion', quantityKg: 120,
    totalPrice: 2160, farmerName: 'Manju K.', farmerPhone: '7654321098',
    dateStr: 'Pickup tomorrow', currentStep: 2,
  },
];

const STEPS: { label: StepStatus; icon: any }[] = [
  { label: 'Confirmed',  icon: 'checkmark-circle' },
  { label: 'Packed',     icon: 'cube-outline' },
  { label: 'In Transit', icon: 'car-outline' },
  { label: 'Delivered',  icon: 'home-outline' },
];

export default function OrdersScreen() {
  const [orders] = useState<OrderItem[]>(MOCK_ORDERS);

  const callFarmer = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Error', 'Unable to place call'));
  };

  const renderItem = ({ item }: { item: OrderItem }) => (
    <View style={styles.orderCard}>
      {/* Top Header */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cropTitle}>{item.crop}</Text>
          <Text style={styles.farmerSub}>
            {item.orderNo} · from {item.farmerName}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.priceText}>₹{item.totalPrice.toLocaleString('en-IN')}</Text>
          <Text style={styles.dateText}>{item.dateStr}</Text>
        </View>
      </View>

      {/* Horizontal Step Progress Bar */}
      <View style={styles.timelineRow}>
        {STEPS.map((s, idx) => {
          const stepNum = idx + 1;
          const isDone = stepNum <= item.currentStep;
          const isCurrent = stepNum === item.currentStep;
          return (
            <React.Fragment key={s.label}>
              {idx > 0 && (
                <View style={[styles.timelineLine, { backgroundColor: idx < item.currentStep ? COLORS.primary : '#E5E7EB' }]} />
              )}
              <View style={styles.stepNode}>
                <View style={[
                  styles.stepIconCircle,
                  isDone && styles.stepIconDone,
                  isCurrent && styles.stepIconCurrent,
                ]}>
                  {isDone ? (
                    <Ionicons name="checkmark" size={12} color={COLORS.textWhite} />
                  ) : (
                    <Text style={styles.stepNumText}>{stepNum}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, isDone && styles.stepLabelDone]}>
                  {s.label}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>

      {/* Contact Action Button */}
      <TouchableOpacity
        style={styles.callBtn}
        onPress={() => callFarmer(item.farmerPhone)}
        activeOpacity={0.8}
      >
        <Ionicons name="call-outline" size={16} color={COLORS.primary} />
        <Text style={styles.callBtnText}>Call {item.farmerName}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Ionicons name="arrow-back" size={22} color={COLORS.textDark} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.title}>My Orders</Text>
          <Text style={styles.subtitle}>Track your orders easily</Text>
        </View>
      </View>

      <View style={styles.scroll}>
        {/* Metric Summary Cards */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <View style={[styles.metricIconBg, { backgroundColor: '#E8F5E9' }]}>
              <FontAwesome5 name="rupee-sign" size={14} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.metricLabel}>Spent This Week</Text>
              <Text style={styles.metricValue}>₹12,480</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={[styles.metricIconBg, { backgroundColor: '#FEF3C7' }]}>
              <FontAwesome5 name="box" size={14} color={COLORS.accentAmber} />
            </View>
            <View>
              <Text style={styles.metricLabel}>Active Orders</Text>
              <Text style={styles.metricValue}>{orders.length}</Text>
            </View>
          </View>
        </View>

        <FlatList
          data={orders}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },

  scroll: { flex: 1, paddingHorizontal: SPACING.xl },

  // Metrics
  metricsRow: { flexDirection: 'row', gap: 12, marginBottom: SPACING.lg, marginTop: 8 },
  metricCard: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    ...SHADOWS.card,
  },
  metricIconBg: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  metricLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  metricValue: { fontSize: 16, fontWeight: '800', color: COLORS.textDark, marginTop: 1 },

  // Order Card
  orderCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.md, ...SHADOWS.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg },
  cropTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  farmerSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  priceText: { fontSize: 17, fontWeight: '800', color: COLORS.primaryDark },
  dateText: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },

  // Step Progress Timeline
  timelineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: SPACING.md, paddingHorizontal: 4 },
  timelineLine: { flex: 1, height: 2, marginTop: -14 },
  stepNode: { alignItems: 'center', width: 60 },
  stepIconCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#F3F4F6', borderWidth: 1.5, borderColor: COLORS.borderDark,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  stepIconDone: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  stepIconCurrent: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  stepNumText: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted },
  stepLabel: { fontSize: 9, color: COLORS.textMuted, fontWeight: '600', textAlign: 'center' },
  stepLabelDone: { color: COLORS.primaryDark, fontWeight: '700' },

  // Call Button
  callBtn: {
    backgroundColor: '#E8F5E9', borderRadius: RADII.pill,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: SPACING.sm, borderWidth: 1, borderColor: '#C8E6C9',
  },
  callBtnText: { color: COLORS.primaryDark, fontWeight: '700', fontSize: 12 },
});
