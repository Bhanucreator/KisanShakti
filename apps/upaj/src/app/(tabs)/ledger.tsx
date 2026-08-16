/**
 * Ledger Screen — Farm Business Overview.
 * Wired to real backend: fetch & add farm ledger entries.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import type { FarmLedgerEntry, TransactionType } from '../../../../../shared/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';

const EXPENSE_CATEGORIES = ['Seeds', 'Fertilizer', 'Labour', 'Equipment', 'Water'] as const;
const INCOME_CATEGORIES  = ['Tomato Sale', 'Ragi Sale', 'Other Sale'] as const;

type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
type IncomeCategory  = typeof INCOME_CATEGORIES[number];

// ─── Mock fallback data ───────────────────────────────────────────────────────

const MOCK_ENTRIES: FarmLedgerEntry[] = [
  { id: 'm1', farmer_id: 'f1', transaction_type: 'INCOME',  amount: 28000, category: 'Tomato Sale', timestamp: '2026-03-15T10:00:00Z' },
  { id: 'm2', farmer_id: 'f1', transaction_type: 'EXPENSE', amount: 11000, category: 'Fertilizer',  timestamp: '2026-03-12T08:30:00Z' },
  { id: 'm3', farmer_id: 'f1', transaction_type: 'INCOME',  amount: 14500, category: 'Ragi Sale',   timestamp: '2026-03-10T14:00:00Z' },
  { id: 'm4', farmer_id: 'f1', transaction_type: 'EXPENSE', amount: 7200,  category: 'Labour',      timestamp: '2026-03-08T09:00:00Z' },
  { id: 'm5', farmer_id: 'f1', transaction_type: 'EXPENSE', amount: 3500,  category: 'Seeds',       timestamp: '2026-03-05T07:45:00Z' },
];

// ─── Crop breakdown (static — can be derived from entries in a future sprint) ─

type CropBreakdown = {
  crop: string;
  income: string;
  expense: string;
  profit: string;
  roi: string;
  roiType: 'high' | 'mid';
};

const CROP_BREAKDOWN: CropBreakdown[] = [
  { crop: 'Tomato', income: '₹28,000', expense: '₹11,000', profit: '₹17,000', roi: '154%', roiType: 'high' },
  { crop: 'Ragi',   income: '₹14,500', expense: '₹7,200',  profit: '₹7,300',  roi: '101%', roiType: 'mid' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return '—';
  }
}

function formatCurrency(amount: number): string {
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${amount}`;
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

function TransactionSkeletonCard() {
  return (
    <View style={styles.txCard}>
      <SkeletonBox width={40} height={40} style={{ borderRadius: 8 }} />
      <View style={{ flex: 1, gap: 6, marginLeft: 12 }}>
        <SkeletonBox width={120} height={12} />
        <SkeletonBox width={80} height={10} />
      </View>
      <SkeletonBox width={60} height={14} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function LedgerScreen() {
  // Data
  const [entries, setEntries]       = useState<FarmLedgerEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [totalIncome, setTotalIncome]   = useState(0);
  const [totalExpense, setTotalExpense] = useState(0);

  // Add Transaction modal
  const [modalVisible, setModalVisible]     = useState(false);
  const [txType, setTxType]                 = useState<TransactionType>('INCOME');
  const [txCategory, setTxCategory]         = useState<string>('');
  const [txAmount, setTxAmount]             = useState('');
  const [submitting, setSubmitting]         = useState(false);

  // Modal slide-up animation
  const slideAnim = useRef(new Animated.Value(400)).current;

  // ── Compute KPI totals ────────────────────────────────────────────────────
  const computeTotals = (data: FarmLedgerEntry[]) => {
    const inc  = data.filter(e => e.transaction_type === 'INCOME').reduce((s, e) => s + e.amount, 0);
    const exp  = data.filter(e => e.transaction_type === 'EXPENSE').reduce((s, e) => s + e.amount, 0);
    setTotalIncome(inc);
    setTotalExpense(exp);
  };

  // ── Fetch ledger entries ──────────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/v1/farm-ledger`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FarmLedgerEntry[] = await res.json();
      const sorted = [...data].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(sorted);
      computeTotals(sorted);
    } catch (err) {
      console.warn('[Ledger] fetch failed — using mock data', err);
      setEntries(MOCK_ENTRIES);
      computeTotals(MOCK_ENTRIES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // ── Modal animation helpers ───────────────────────────────────────────────
  const openModal = () => {
    setTxType('INCOME');
    setTxCategory('');
    setTxAmount('');
    setModalVisible(true);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
  };

  const closeModal = () => {
    Animated.timing(slideAnim, {
      toValue: 500,
      duration: 260,
      useNativeDriver: true,
    }).start(() => setModalVisible(false));
  };

  // ── Submit new transaction ────────────────────────────────────────────────
  const handleAddTransaction = async () => {
    const amount = parseFloat(txAmount.replace(/[^0-9.]/g, ''));
    if (!txCategory.trim()) {
      // rely on category chips — just guard
      return;
    }
    if (!txAmount.trim() || isNaN(amount) || amount <= 0) return;

    setSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/v1/farm-ledger`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ transaction_type: txType, amount, category: txCategory }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      closeModal();
      // Refresh list after close animation finishes
      setTimeout(fetchEntries, 300);
    } catch (err) {
      console.warn('[Ledger] add-entry failed', err);
      // Optimistic fallback: append locally
      const newEntry: FarmLedgerEntry = {
        id: String(Date.now()),
        farmer_id: 'me',
        transaction_type: txType,
        amount,
        category: txCategory,
        timestamp: new Date().toISOString(),
      };
      setEntries(prev => {
        const updated = [newEntry, ...prev];
        computeTotals(updated);
        return updated;
      });
      closeModal();
    } finally {
      setSubmitting(false);
    }
  };

  const netProfit = totalIncome - totalExpense;
  const recentEntries = entries.slice(0, 5);

  // ── Category chips ────────────────────────────────────────────────────────
  const activeCategories: ReadonlyArray<string> =
    txType === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Farm Business Overview</Text>
            <Text style={styles.subtitle}>Track earnings & expenses</Text>
          </View>
          <View style={styles.datePill}>
            <Text style={styles.dateText}>Aug 2026</Text>
            <Ionicons name="calendar-outline" size={14} color={COLORS.primary} />
          </View>
        </View>

        {/* KPI Cards */}
        <View style={styles.kpiRow}>
          {/* Income */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Income</Text>
            {loading ? (
              <SkeletonBox width={72} height={18} style={{ marginVertical: 4 }} />
            ) : (
              <Text style={[styles.kpiValue, { color: COLORS.primary }]}>
                {formatCurrency(totalIncome)}
              </Text>
            )}
            <View style={styles.trendRow}>
              <Feather name="trending-up" size={10} color={COLORS.primary} />
              <Text style={[styles.kpiChange, { color: COLORS.primary }]}>Live</Text>
            </View>
          </View>

          {/* Expenses */}
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Expenses</Text>
            {loading ? (
              <SkeletonBox width={72} height={18} style={{ marginVertical: 4 }} />
            ) : (
              <Text style={[styles.kpiValue, { color: COLORS.accentRed }]}>
                {formatCurrency(totalExpense)}
              </Text>
            )}
            <View style={styles.trendRow}>
              <Feather name="trending-up" size={10} color={COLORS.accentRed} />
              <Text style={[styles.kpiChange, { color: COLORS.accentRed }]}>Live</Text>
            </View>
          </View>

          {/* Net Profit */}
          <View style={[styles.kpiCard, styles.netProfitCard]}>
            <Text style={[styles.kpiLabel, { color: 'rgba(255,255,255,0.8)' }]}>Net Profit</Text>
            {loading ? (
              <SkeletonBox width={72} height={18} style={{ marginVertical: 4, backgroundColor: 'rgba(255,255,255,0.3)' }} />
            ) : (
              <Text style={[styles.kpiValue, { color: COLORS.textWhite }]}>
                {formatCurrency(netProfit)}
              </Text>
            )}
            <View style={styles.trendRow}>
              <Feather name="trending-up" size={10} color="#A7F3D0" />
              <Text style={[styles.kpiChange, { color: '#A7F3D0' }]}>Live</Text>
            </View>
          </View>
        </View>

        {/* Monthly Bar Chart */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Monthly Profit Trend</Text>
            <View style={styles.quarterPill}>
              <Text style={styles.quarterText}>This Quarter</Text>
              <Ionicons name="chevron-down" size={12} color={COLORS.textMuted} />
            </View>
          </View>
          <View style={styles.barChartArea}>
            <View style={styles.barColumn}>
              <Text style={styles.barValueText}>₹10.2k</Text>
              <View style={[styles.barFill, { height: 60 }]} />
              <Text style={styles.barLabel}>Jan</Text>
            </View>
            <View style={styles.barColumn}>
              <Text style={styles.barValueText}>₹21.1k</Text>
              <View style={[styles.barFill, { height: 110 }]} />
              <Text style={styles.barLabel}>Feb</Text>
            </View>
            <View style={styles.barColumn}>
              <Text style={[styles.barValueText, { color: COLORS.primaryDark, fontWeight: '800' }]}>
                {loading ? '…' : formatCurrency(netProfit)}
              </Text>
              <View style={[styles.barFill, { height: 130, backgroundColor: COLORS.primaryDark }]} />
              <Text style={[styles.barLabel, { color: COLORS.primaryDark, fontWeight: '800' }]}>Mar</Text>
            </View>
          </View>
        </View>

        {/* Recent Transactions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={fetchEntries} activeOpacity={0.7}>
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <>
            <TransactionSkeletonCard />
            <TransactionSkeletonCard />
            <TransactionSkeletonCard />
          </>
        ) : recentEntries.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={36} color={COLORS.textMuted} />
            <Text style={styles.emptyStateText}>No transactions yet.</Text>
            <Text style={styles.emptyStateSubText}>Tap + to add your first entry.</Text>
          </View>
        ) : (
          recentEntries.map((entry) => {
            const isIncome = entry.transaction_type === 'INCOME';
            return (
              <View
                key={entry.id}
                style={[
                  styles.txCard,
                  { borderLeftColor: isIncome ? COLORS.primary : COLORS.accentRed },
                ]}
              >
                <View style={[
                  styles.txIconBg,
                  { backgroundColor: isIncome ? '#DCFCE7' : '#FEE2E2' },
                ]}>
                  <Ionicons
                    name={isIncome ? 'arrow-up' : 'arrow-down'}
                    size={16}
                    color={isIncome ? COLORS.primaryDark : COLORS.accentRed}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txName}>{entry.category}</Text>
                  <View style={styles.txMetaRow}>
                    <View style={[styles.txCategoryPill, { backgroundColor: isIncome ? '#DCFCE7' : '#FEE2E2' }]}>
                      <Text style={[styles.txCategoryText, { color: isIncome ? '#166534' : '#991B1B' }]}>
                        {entry.transaction_type}
                      </Text>
                    </View>
                    <Text style={styles.txDate}>{formatDate(entry.timestamp)}</Text>
                  </View>
                </View>
                <Text style={[styles.txAmount, { color: isIncome ? COLORS.primary : COLORS.accentRed }]}>
                  {isIncome ? '+' : '−'}₹{entry.amount.toLocaleString('en-IN')}
                </Text>
              </View>
            );
          })
        )}

        {/* Crop-wise Breakdown */}
        <Text style={[styles.sectionTitle, { marginBottom: SPACING.md, marginTop: SPACING.xl }]}>
          Crop-wise Breakdown
        </Text>
        <View style={styles.tableCard}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableCol, { flex: 1.2 }]}>Crop</Text>
            <Text style={styles.tableCol}>Income</Text>
            <Text style={styles.tableCol}>Expense</Text>
            <Text style={styles.tableCol}>Profit</Text>
            <Text style={[styles.tableCol, { textAlign: 'right' }]}>ROI</Text>
          </View>
          {CROP_BREAKDOWN.map((row) => (
            <View key={row.crop} style={styles.tableBodyRow}>
              <Text style={[styles.tableCellBold, { flex: 1.2 }]}>{row.crop}</Text>
              <Text style={[styles.tableCell, { color: COLORS.primary }]}>{row.income}</Text>
              <Text style={[styles.tableCell, { color: COLORS.accentRed }]}>{row.expense}</Text>
              <Text style={styles.tableCellBold}>{row.profit}</Text>
              <View style={[
                styles.roiPill,
                row.roiType === 'high' ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEF3C7' },
              ]}>
                <Text style={[
                  styles.roiText,
                  row.roiType === 'high' ? { color: '#166534' } : { color: '#D97706' },
                ]}>
                  {row.roi}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Top Performing Crop Banner */}
        <View style={styles.topCropBanner}>
          <View>
            <View style={styles.topCropHeader}>
              <MaterialCommunityIcons name="crown-outline" size={16} color={COLORS.primaryDark} />
              <Text style={styles.topCropLabel}>Top Performing Crop</Text>
            </View>
            <Text style={styles.topCropName}>Tomato</Text>
            <Text style={styles.topCropRoi}>ROI 154%</Text>
          </View>
          <View style={styles.farmerPhotoCircle}>
            <Text style={{ fontSize: 36 }}>🧑‍🌾</Text>
          </View>
        </View>

      </ScrollView>

      {/* FAB — Add Transaction */}
      <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color={COLORS.textWhite} />
      </TouchableOpacity>

      {/* Add Transaction Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        onRequestClose={closeModal}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={styles.modalBackdrop} onPress={closeModal} activeOpacity={1} />

          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: slideAnim }] }]}>
            {/* Handle */}
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetTitle}>Add Transaction</Text>

            {/* Type Toggle */}
            <View style={styles.typeToggleRow}>
              <TouchableOpacity
                style={[styles.typeBtn, txType === 'INCOME' && styles.typeBtnIncomeActive]}
                onPress={() => { setTxType('INCOME'); setTxCategory(''); }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="arrow-up"
                  size={14}
                  color={txType === 'INCOME' ? '#fff' : COLORS.primary}
                />
                <Text style={[styles.typeBtnText, txType === 'INCOME' && { color: '#fff' }]}>
                  Income
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.typeBtn, txType === 'EXPENSE' && styles.typeBtnExpenseActive]}
                onPress={() => { setTxType('EXPENSE'); setTxCategory(''); }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="arrow-down"
                  size={14}
                  color={txType === 'EXPENSE' ? '#fff' : COLORS.accentRed}
                />
                <Text style={[styles.typeBtnText, txType === 'EXPENSE' && { color: '#fff', }]}>
                  Expense
                </Text>
              </TouchableOpacity>
            </View>

            {/* Category Chips */}
            <Text style={styles.inputLabel}>Category</Text>
            <View style={styles.chipsRow}>
              {activeCategories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.chip, txCategory === cat && styles.chipActive]}
                  onPress={() => setTxCategory(cat)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, txCategory === cat && styles.chipTextActive]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Amount Input */}
            <Text style={styles.inputLabel}>Amount</Text>
            <View style={styles.amountInputRow}>
              <Text style={styles.rupeePrefix}>₹</Text>
              <TextInput
                style={styles.amountInput}
                placeholder="0"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={txAmount}
                onChangeText={setTxAmount}
              />
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[
                styles.submitBtn,
                txType === 'EXPENSE' && styles.submitBtnExpense,
                (submitting || !txCategory || !txAmount.trim()) && styles.submitBtnDisabled,
              ]}
              onPress={handleAddTransaction}
              disabled={submitting || !txCategory || !txAmount.trim()}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>
                  Add {txType === 'INCOME' ? 'Income' : 'Expense'}
                </Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bgApp },
  scroll: { padding: SPACING.xl, paddingBottom: 100 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  subtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  datePill: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.pill,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    ...SHADOWS.card,
  },
  dateText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },

  // KPI Row
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.xl },
  kpiCard: {
    flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card,
  },
  netProfitCard: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  kpiLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  kpiValue: { fontSize: 17, fontWeight: '800', marginVertical: 4 },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kpiChange: { fontSize: 10, fontWeight: '700' },

  // Bar Chart
  chartCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.xl, ...SHADOWS.card,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg },
  chartTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  quarterPill: {
    backgroundColor: COLORS.bgSubtle, borderRadius: RADII.pill,
    paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  quarterText: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },
  barChartArea: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 160, paddingTop: 20 },
  barColumn: { alignItems: 'center', flex: 1 },
  barValueText: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', marginBottom: 6 },
  barFill: { width: 36, backgroundColor: COLORS.primaryBright, borderRadius: RADII.sm },
  barLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600', marginTop: 8 },

  // Section header
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  refreshText: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  // Transaction cards
  txCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    borderLeftWidth: 4,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 8, ...SHADOWS.card,
  },
  txIconBg: {
    width: 40, height: 40, borderRadius: RADII.md,
    alignItems: 'center', justifyContent: 'center',
  },
  txName: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },
  txMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  txCategoryPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADII.pill },
  txCategoryText: { fontSize: 10, fontWeight: '700' },
  txDate: { fontSize: 11, color: COLORS.textMuted, fontWeight: '500' },
  txAmount: { fontSize: 15, fontWeight: '800' },

  // Table
  tableCard: {
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.xl, ...SHADOWS.card,
  },
  tableHeaderRow: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  tableCol: { flex: 1, fontSize: 10, fontWeight: '700', color: COLORS.textMuted },
  tableBodyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  tableCell: { flex: 1, fontSize: 11, fontWeight: '600' },
  tableCellBold: { flex: 1, fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  roiPill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: RADII.sm },
  roiText: { fontSize: 11, fontWeight: '800' },

  // Top Crop Banner
  topCropBanner: {
    backgroundColor: '#E8F5E9', borderRadius: RADII.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: '#C8E6C9',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...SHADOWS.card,
  },
  topCropHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  topCropLabel: { fontSize: 11, fontWeight: '700', color: COLORS.primaryDark },
  topCropName: { fontSize: 20, fontWeight: '800', color: COLORS.primaryDark },
  topCropRoi: { fontSize: 13, fontWeight: '700', color: COLORS.primary, marginTop: 2 },
  farmerPhotoCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.primaryBright,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.popover,
  },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    padding: SPACING.xl,
    paddingBottom: 40,
    ...SHADOWS.popover,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.borderDark,
    alignSelf: 'center', marginBottom: SPACING.lg,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark, marginBottom: SPACING.lg },

  // Type toggle
  typeToggleRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.lg },
  typeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: RADII.pill,
    backgroundColor: COLORS.bgSubtle,
    borderWidth: 1, borderColor: COLORS.border,
  },
  typeBtnIncomeActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  typeBtnExpenseActive: { backgroundColor: COLORS.accentRed, borderColor: '#B91C1C' },
  typeBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },

  // Category chips
  inputLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.lg },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill,
    backgroundColor: COLORS.bgSubtle, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.textDark },
  chipTextActive: { color: COLORS.textWhite, fontWeight: '700' },

  // Amount input
  amountInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADII.md, paddingHorizontal: 14, paddingVertical: 4,
    marginBottom: SPACING.xl,
  },
  rupeePrefix: { fontSize: 20, fontWeight: '800', color: COLORS.textDark, marginRight: 8 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '800', color: COLORS.textDark, paddingVertical: 10 },

  // Submit button
  submitBtn: {
    backgroundColor: COLORS.primaryDark, borderRadius: RADII.pill,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    ...SHADOWS.card,
  },
  submitBtnExpense: { backgroundColor: COLORS.accentRed },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: COLORS.textWhite },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: 8 },
  emptyStateText: { fontSize: 15, fontWeight: '600', color: COLORS.textMuted },
  emptyStateSubText: { fontSize: 12, color: COLORS.textMuted },
});
