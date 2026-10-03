/**
 * Farm Business Overview — the dynamic, generational version.
 *
 * Everything on this screen traces back to a real logged crop cycle on a
 * real plot. No hardcoded ROI, no mock entries, no fake "top crop" banner.
 *
 * Flow:
 *   Empty state (no plots)  → "Create your first plot"
 *   Plot list               → tap a plot → cycle list + summary + recs
 *     └ FAB "+ new cycle"   → cycle detail
 *   Cycle detail            → running totals, add expense/income, harvest
 *
 * Bilingual throughout via t(en, kn) helper — matches Weather-tab style.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, Animated, KeyboardAvoidingView, Platform,
  RefreshControl, ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, SPACING, RADII, SHADOWS } from '../../constants/theme';
import {
  fetchPlots, createPlot, deletePlot, fetchCycles, createCycle, addCycleEntry,
  markCycleHarvested, updateCycle, fetchRecommendations, fetchYoYHistory,
  fetchPlotSummary, initPlotTransfer, acceptPlotTransfer,
  type Plot, type CropCycle, type Recommendation, type RecommendationResponse,
  type YearPoint, type PlotSummary,
} from '../../lib/api';

// ── Constants ────────────────────────────────────────────────────────────────
const t = (en: string, kn: string) => `${en}\n${kn}`;

// Business-tab-only decorative background. The image has designed-in header
// (farmer illustration up top) and footer (landscape) zones with a mostly
// blank sky in the middle — perfect for UI to overlay. We use ImageBackground
// as the OUTER wrapper (renders behind children reliably on both iOS and
// Android) and drop a soft white veil on top so cards + text remain crisp.
// The SafeAreaView inside is made transparent so its bg color doesn't hide
// the image.
const BG_SOURCE = require('../../../assets/images/profits_tb.png');
function ScreenBg({ children }: { children: React.ReactNode }) {
  return (
    <ImageBackground
      source={BG_SOURCE}
      style={styles.bgRoot}
      imageStyle={styles.bgImage}
      resizeMode="cover"
    >
      <View style={styles.bgVeil} pointerEvents="box-none">
        {children}
      </View>
    </ImageBackground>
  );
}

const EXPENSE_SUBCATEGORIES: Array<{ key: string; en: string; kn: string; icon: any }> = [
  { key: 'SEEDS',      en: 'Seeds',      kn: 'ಬೀಜಗಳು',   icon: 'seed-outline' },
  { key: 'FERTILIZER', en: 'Fertilizer', kn: 'ಗೊಬ್ಬರ',    icon: 'flower-outline' },
  { key: 'LABOR',      en: 'Labor',      kn: 'ಕೂಲಿ',      icon: 'account-hard-hat' },
  { key: 'IRRIGATION', en: 'Irrigation', kn: 'ನೀರಾವರಿ',   icon: 'water-outline' },
  { key: 'PESTICIDE',  en: 'Pesticide',  kn: 'ಔಷಧ',       icon: 'bug-outline' },
  { key: 'EQUIPMENT',  en: 'Equipment',  kn: 'ಸಾಧನ',      icon: 'wrench-outline' },
  { key: 'OTHER',      en: 'Other',      kn: 'ಇತರ',       icon: 'dots-horizontal' },
];

const INCOME_SUBCATEGORIES: Array<{ key: string; en: string; kn: string; icon: any }> = [
  { key: 'SALE',    en: 'Crop Sale', kn: 'ಬೆಳೆ ಮಾರಾಟ', icon: 'cash-multiple' },
  { key: 'SUBSIDY', en: 'Subsidy',   kn: 'ಸಬ್ಸಿಡಿ',    icon: 'hand-coin-outline' },
  { key: 'OTHER',   en: 'Other',     kn: 'ಇತರ',        icon: 'dots-horizontal' },
];

const MONTHS = [
  { m: 1, en: 'Jan', kn: 'ಜನ' }, { m: 2, en: 'Feb', kn: 'ಫೆ' },
  { m: 3, en: 'Mar', kn: 'ಮಾ' }, { m: 4, en: 'Apr', kn: 'ಏ' },
  { m: 5, en: 'May', kn: 'ಮೇ' }, { m: 6, en: 'Jun', kn: 'ಜೂ' },
  { m: 7, en: 'Jul', kn: 'ಜು' }, { m: 8, en: 'Aug', kn: 'ಆ' },
  { m: 9, en: 'Sep', kn: 'ಸೆ' }, { m: 10, en: 'Oct', kn: 'ಅ' },
  { m: 11, en: 'Nov', kn: 'ನ' }, { m: 12, en: 'Dec', kn: 'ಡಿ' },
];

const fmtIN = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthOf = (iso: string) => parseInt(iso.slice(5, 7), 10);

// ── Screen ────────────────────────────────────────────────────────────────────

type ScreenView = 'plots' | 'plot-detail' | 'cycle-detail';

export default function LedgerScreen() {
  const [view, setView] = useState<ScreenView>('plots');
  const [plots, setPlots] = useState<Plot[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedPlot, setSelectedPlot] = useState<Plot | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<CropCycle | null>(null);

  const [showNewPlot, setShowNewPlot] = useState(false);
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const load = useCallback(async () => {
    const p = await fetchPlots();
    setPlots(p ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ── Router within the screen ─────────────────────────────────────────
  if (loading) return <LoadingScaffold />;

  if (view === 'cycle-detail' && selectedCycle && selectedPlot) {
    return (
      <CycleDetailScreen
        plot={selectedPlot}
        cycle={selectedCycle}
        onBack={() => { setView('plot-detail'); load(); }}
        onAddEntry={() => setShowAddEntry(true)}
        onCycleUpdated={(c) => { setSelectedCycle(c); load(); }}
        onDone={() => { setView('plot-detail'); load(); }}
        showAddEntry={showAddEntry}
        closeAddEntry={() => setShowAddEntry(false)}
      />
    );
  }

  if (view === 'plot-detail' && selectedPlot) {
    return (
      <PlotDetailScreen
        plot={selectedPlot}
        onBack={() => { setView('plots'); load(); }}
        onOpenCycle={(c) => { setSelectedCycle(c); setView('cycle-detail'); }}
        onNewCycle={() => setShowNewCycle(true)}
        onTransfer={() => setShowTransfer(true)}
        onDeleted={() => { setSelectedPlot(null); setView('plots'); load(); }}
        showNewCycle={showNewCycle}
        closeNewCycle={() => setShowNewCycle(false)}
        showTransfer={showTransfer}
        closeTransfer={() => setShowTransfer(false)}
      />
    );
  }

  // Plot list view (root)
  return (
    <ScreenBg>
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Farm Business</Text>
            <Text style={styles.titleKn}>ಕೃಷಿ ವ್ಯಾಪಾರ</Text>
            <Text style={styles.subtitle}>
              Track every season · ROI unlocks after 2 seasons
              {'\n'}ಪ್ರತಿ ಋತು ಟ್ರ್ಯಾಕ್ · 2 ಋತುಗಳ ನಂತರ ಶಿಫಾರಸ್ಸು
            </Text>
          </View>
          <TouchableOpacity
            style={styles.acceptTransferPill}
            onPress={() => setShowTransfer(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="key-outline" size={13} color={COLORS.primary} />
            <Text style={styles.acceptTransferText}>Claim{'\n'}ಸ್ವೀಕರಿಸು</Text>
          </TouchableOpacity>
        </View>

        {plots && plots.length === 0 && (
          <EmptyPlotsCard onCreate={() => setShowNewPlot(true)} />
        )}

        {plots && plots.length > 0 && plots.map((p) => (
          <PlotCard
            key={p.id}
            plot={p}
            onPress={() => { setSelectedPlot(p); setView('plot-detail'); }}
          />
        ))}

        {plots && plots.length > 0 && (
          <TouchableOpacity
            style={styles.addPlotBtn}
            onPress={() => setShowNewPlot(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
            <Text style={styles.addPlotBtnText}>
              Add another plot · ಇನ್ನೊಂದು ಹೊಲ ಸೇರಿಸಿ
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <NewPlotModal
        visible={showNewPlot}
        onClose={() => setShowNewPlot(false)}
        onCreated={(p) => { setShowNewPlot(false); load(); setSelectedPlot(p); setView('plot-detail'); }}
      />

      <ClaimTransferModal
        visible={showTransfer}
        onClose={() => setShowTransfer(false)}
        onAccepted={() => { setShowTransfer(false); load(); }}
      />
    </SafeAreaView>
    </ScreenBg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PLOT LIST
// ══════════════════════════════════════════════════════════════════════════════

function EmptyPlotsCard({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconRing}>
        <MaterialCommunityIcons name="terrain" size={36} color={COLORS.primary} />
      </View>
      <Text style={styles.emptyTitle}>Add your first plot</Text>
      <Text style={styles.emptyTitleKn}>ಮೊದಲ ಹೊಲ ಸೇರಿಸಿ</Text>
      <Text style={styles.emptyMsg}>
        Every expense and sale you log will build your farm's own ROI history —
        recommendations start appearing after 2 completed seasons of any crop.
      </Text>
      <Text style={styles.emptyMsgKn}>
        ನೀವು ದಾಖಲಿಸುವ ಪ್ರತಿ ಖರ್ಚು ಮತ್ತು ಮಾರಾಟದಿಂದ ಶಿಫಾರಸ್ಸು ರೂಪುಗೊಳ್ಳುತ್ತದೆ.
      </Text>
      <TouchableOpacity style={styles.emptyCta} onPress={onCreate} activeOpacity={0.85}>
        <Ionicons name="add" size={18} color={COLORS.bgCard} />
        <Text style={styles.emptyCtaText}>Create plot · ಹೊಲ ರಚಿಸಿ</Text>
      </TouchableOpacity>
    </View>
  );
}

function PlotCard({ plot, onPress }: { plot: Plot; onPress: () => void }) {
  const roiColor =
    plot.last_completed_roi == null ? COLORS.textMuted
      : plot.last_completed_roi >= 100 ? COLORS.primary
      : plot.last_completed_roi >= 0   ? '#D97706'
      : COLORS.accentRed;

  // Left status strip color tells the farmer at a glance what state the
  // plot is in without reading anything:
  //   green  = active cycle growing right now
  //   grey   = idle (waiting to start a cycle)
  const stripColor = plot.active_cycle ? COLORS.primary : COLORS.borderDark;

  return (
    <TouchableOpacity style={styles.plotCard} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.plotStrip, { backgroundColor: stripColor }]} />

      <View style={styles.plotCardBody}>
        <View style={styles.plotCardTop}>
          <View style={styles.plotIconRing}>
            <MaterialCommunityIcons name="terrain" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.plotLabel}>{plot.label}</Text>
            {plot.label_kn && <Text style={styles.plotLabelKn}>{plot.label_kn}</Text>}
            <Text style={styles.plotArea}>
              {plot.area_ha} ha · {plot.cycles_count} {plot.cycles_count === 1 ? 'cycle' : 'cycles'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </View>

        {plot.active_cycle ? (
          <View style={styles.activeCycleBadge}>
            <View style={styles.activeCycleDot} />
            <Text style={styles.activeCycleText} numberOfLines={1}>
              Growing {plot.active_cycle.crop_name}
            </Text>
          </View>
        ) : (
          <View style={styles.idleBadge}>
            <Ionicons name="leaf-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.idleBadgeText}>Idle · ಸಕ್ರಿಯ ಋತು ಇಲ್ಲ</Text>
          </View>
        )}

        <View style={styles.plotRoiRow}>
          <Text style={styles.plotRoiLabel}>Last ROI · ಕೊನೆಯ ROI</Text>
          <Text style={[styles.plotRoiValue, { color: roiColor }]}>
            {plot.last_completed_roi == null ? '—' : `${Math.round(plot.last_completed_roi)}%`}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PLOT DETAIL — summary, cycles, recommendations
// ══════════════════════════════════════════════════════════════════════════════

function PlotDetailScreen({
  plot, onBack, onOpenCycle, onNewCycle, onTransfer, onDeleted,
  showNewCycle, closeNewCycle, showTransfer, closeTransfer,
}: {
  plot: Plot; onBack: () => void;
  onOpenCycle: (c: CropCycle) => void;
  onNewCycle: () => void;
  onTransfer: () => void;
  onDeleted: () => void;
  showNewCycle: boolean; closeNewCycle: () => void;
  showTransfer: boolean; closeTransfer: () => void;
}) {
  const [cycles, setCycles] = useState<CropCycle[] | null>(null);
  const [summary, setSummary] = useState<PlotSummary | null>(null);
  const [recs, setRecs]       = useState<RecommendationResponse | null>(null);
  const [recMonth, setRecMonth] = useState<number>(new Date().getMonth() + 1);
  const [refreshing, setRefreshing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(async () => {
    const [c, s, r] = await Promise.all([
      fetchCycles(plot.id),
      fetchPlotSummary(plot.id),
      fetchRecommendations(plot.id, recMonth),
    ]);
    setCycles(c ?? []);
    setSummary(s ?? null);
    setRecs(r ?? null);
  }, [plot.id, recMonth]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  return (
    <ScreenBg>
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Back header */}
        <View style={styles.backHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textDark} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{plot.label}</Text>
            {plot.label_kn && <Text style={styles.titleKn}>{plot.label_kn}</Text>}
            <Text style={styles.subtitle}>{plot.area_ha} ha</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={onTransfer} style={styles.transferIconBtn} activeOpacity={0.7}>
              <Ionicons name="share-outline" size={18} color={COLORS.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowDelete(true)} style={styles.deleteIconBtn} activeOpacity={0.7}>
              <Ionicons name="trash-outline" size={18} color={COLORS.accentRed} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Summary card */}
        <SummaryCard summary={summary} />

        {/* Recommendations */}
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>What to plant?</Text>
            <Text style={styles.sectionTitleKn}>ಏನು ಬಿತ್ತಬೇಕು?</Text>
          </View>
          <MonthPicker value={recMonth} onChange={setRecMonth} />
        </View>
        <RecommendationsCard response={recs} month={recMonth} />

        {/* Cycles */}
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Cycles</Text>
            <Text style={styles.sectionTitleKn}>ಋತುಗಳು</Text>
          </View>
          <TouchableOpacity style={styles.newCycleBtn} onPress={onNewCycle} activeOpacity={0.85}>
            <Ionicons name="add" size={16} color={COLORS.bgCard} />
            <Text style={styles.newCycleBtnText}>New · ಹೊಸ</Text>
          </TouchableOpacity>
        </View>

        {cycles == null && <ActivityIndicator style={{ marginVertical: 20 }} color={COLORS.primary} />}
        {cycles && cycles.length === 0 && (
          <View style={styles.emptySmall}>
            <Text style={styles.emptySmallText}>
              No cycles yet · ಇನ್ನೂ ಋತು ಇಲ್ಲ{'\n'}
              Tap New to start logging a season.
            </Text>
          </View>
        )}
        {cycles && cycles.map((c) => (
          <CycleRow key={c.id} cycle={c} onPress={() => onOpenCycle(c)} />
        ))}
      </ScrollView>

      <NewCycleModal
        visible={showNewCycle}
        onClose={closeNewCycle}
        onCreated={(_c) => { closeNewCycle(); load(); }}
        plotId={plot.id}
      />

      <TransferInitModal
        visible={showTransfer}
        onClose={closeTransfer}
        plotId={plot.id}
        plotLabel={plot.label}
      />

      <DeletePlotModal
        visible={showDelete}
        onClose={() => setShowDelete(false)}
        plot={plot}
        cyclesCount={cycles?.length ?? 0}
        onDeleted={() => { setShowDelete(false); onDeleted(); }}
      />
    </SafeAreaView>
    </ScreenBg>
  );
}

function SummaryCard({ summary }: { summary: PlotSummary | null }) {
  if (!summary) return null;

  const hasData = summary.harvested_cycles > 0;

  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryLabel}>{summary.current_year} profit · ಈ ವರ್ಷದ ಲಾಭ</Text>
          <Text style={[styles.summaryValue, {
            color: summary.current_year_profit >= 0 ? COLORS.primary : COLORS.accentRed,
          }]}>
            {summary.current_year_profit >= 0 ? '+' : ''}{fmtIN(summary.current_year_profit)}
          </Text>
        </View>
        <View style={styles.summaryStats}>
          <Text style={styles.summaryStatNum}>{summary.harvested_cycles}</Text>
          <Text style={styles.summaryStatLabel}>seasons{'\n'}ಋತುಗಳು</Text>
        </View>
      </View>

      {!hasData ? (
        <View style={styles.summaryEmpty}>
          <Text style={styles.summaryEmptyText}>
            Complete your first harvest to see best/worst crop insights.{'\n'}
            ಮೊದಲ ಸುಗ್ಗಿ ಪೂರ್ಣಗೊಳಿಸಿ.
          </Text>
        </View>
      ) : (
        <View style={styles.summaryBadges}>
          {summary.best_crop && (
            <View style={[styles.summaryBadge, styles.summaryBadgeGood]}>
              <MaterialCommunityIcons name="crown-outline" size={14} color={COLORS.primaryDark} />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryBadgeLabel}>Best · ಅತ್ಯುತ್ತಮ</Text>
                <Text style={styles.summaryBadgeCrop}>
                  {summary.best_crop.crop_name} · {Math.round(summary.best_crop.roi_percent)}%
                </Text>
              </View>
            </View>
          )}
          {summary.worst_crop && (
            <View style={[styles.summaryBadge, styles.summaryBadgeBad]}>
              <Ionicons name="alert-circle-outline" size={14} color="#B45309" />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryBadgeLabel}>Worst · ಕಳಪೆ</Text>
                <Text style={styles.summaryBadgeCrop}>
                  {summary.worst_crop.crop_name} · {Math.round(summary.worst_crop.roi_percent)}%
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function MonthPicker({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  const [open, setOpen] = useState(false);
  const cur = MONTHS.find(m => m.m === value)!;
  return (
    <>
      <TouchableOpacity style={styles.monthPill} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={styles.monthPillText}>{cur.en} · {cur.kn}</Text>
        <Ionicons name="chevron-down" size={12} color={COLORS.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.monthOverlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={styles.monthGrid}>
            {MONTHS.map((m) => (
              <TouchableOpacity
                key={m.m}
                style={[styles.monthCell, m.m === value && styles.monthCellActive]}
                onPress={() => { onChange(m.m); setOpen(false); }}
              >
                <Text style={[styles.monthCellText, m.m === value && styles.monthCellTextActive]}>
                  {m.en}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function RecommendationsCard({
  response, month,
}: { response: RecommendationResponse | null; month: number }) {
  if (!response) return <ActivityIndicator style={{ marginVertical: 20 }} color={COLORS.primary} />;

  const monthName = MONTHS.find(m => m.m === month)!;

  if (response.status === 'insufficient_data') {
    return (
      <View style={styles.recCard}>
        <View style={styles.recEmptyIcon}>
          <Ionicons name="hourglass-outline" size={26} color={COLORS.textMuted} />
        </View>
        <Text style={styles.recEmptyTitle}>
          Not enough data yet
        </Text>
        <Text style={styles.recEmptyTitleKn}>ಸಾಕಷ್ಟು ದತ್ತಾಂಶ ಇಲ್ಲ</Text>
        <Text style={styles.recEmptyMsg}>
          {response.reason}{'\n\n'}
          {response.near_hits && response.near_hits > 0
            ? `${response.near_hits} crop${response.near_hits > 1 ? 's' : ''} tracked around ${monthName.en} — 1 more season each unlocks recommendations.`
            : `Log a harvest with sowing in ${monthName.en} (±1 month) to start building history.`}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.recCard}>
      <Text style={styles.recIntro}>
        Ranked by your own past ROI in {monthName.en} on this plot
      </Text>
      {response.recommendations.map((r, i) => (
        <RecommendationRow key={r.crop_name} rec={r} rank={i + 1} />
      ))}
    </View>
  );
}

function RecommendationRow({ rec, rank }: { rec: Recommendation; rank: number }) {
  const color =
    rec.avg_roi >= 100 ? COLORS.primary
      : rec.avg_roi >= 0 ? '#D97706'
      : COLORS.accentRed;

  return (
    <View style={styles.recRow}>
      <View style={styles.recRank}><Text style={styles.recRankText}>#{rank}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.recCrop}>{rec.crop_name}</Text>
        {rec.crop_name_kn && <Text style={styles.recCropKn}>{rec.crop_name_kn}</Text>}
        <View style={styles.recMetaRow}>
          <Text style={styles.recMeta}>
            {rec.seasons_tracked} seasons · {Math.round(rec.min_roi)}–{Math.round(rec.max_roi)}%
          </Text>
          {rec.variable && (
            <View style={styles.recVarPill}>
              <Ionicons name="warning-outline" size={10} color="#B45309" />
              <Text style={styles.recVarText}>variable</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={[styles.recRoi, { color }]}>{Math.round(rec.avg_roi)}%</Text>
    </View>
  );
}

function CycleRow({ cycle, onPress }: { cycle: CropCycle; onPress: () => void }) {
  const statusColor =
    cycle.status === 'HARVESTED' ? COLORS.primary
      : cycle.status === 'GROWING' ? '#D97706'
      : cycle.status === 'ABANDONED' ? COLORS.accentRed
      : COLORS.textMuted;

  const statusLabel =
    cycle.status === 'HARVESTED' ? 'Harvested · ಸುಗ್ಗಿ'
      : cycle.status === 'GROWING'   ? 'Growing · ಬೆಳೆಯುತ್ತಿದೆ'
      : cycle.status === 'ABANDONED' ? 'Abandoned · ಬಿಟ್ಟುಬಿಟ್ಟಿದೆ'
      : 'Planned · ಯೋಜಿತ';

  return (
    <TouchableOpacity style={styles.cycleRow} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.cycleStatusStrip, { backgroundColor: statusColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.cycleCrop}>{cycle.crop_name}</Text>
        {cycle.crop_name_kn && <Text style={styles.cycleCropKn}>{cycle.crop_name_kn}</Text>}
        <Text style={styles.cycleMeta}>
          Sowed {cycle.sowing_date}
          {cycle.actual_harvest_date ? ` · Harvested ${cycle.actual_harvest_date}` : ''}
        </Text>
        <Text style={[styles.cycleStatus, { color: statusColor }]}>{statusLabel}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {cycle.roi_percent != null ? (
          <Text style={[styles.cycleRoi, { color: statusColor }]}>
            {Math.round(cycle.roi_percent)}%
          </Text>
        ) : (
          <Text style={styles.cycleRunning}>
            Spent{'\n'}{fmtIN(cycle.total_expenses)}
          </Text>
        )}
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={{ marginTop: 4 }} />
      </View>
    </TouchableOpacity>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CYCLE DETAIL — running totals, add entries, harvest
// ══════════════════════════════════════════════════════════════════════════════

function CycleDetailScreen({
  plot, cycle, onBack, onAddEntry, onCycleUpdated, onDone,
  showAddEntry, closeAddEntry,
}: {
  plot: Plot; cycle: CropCycle;
  onBack: () => void;
  onAddEntry: () => void;
  onCycleUpdated: (c: CropCycle) => void;
  onDone: () => void;
  showAddEntry: boolean; closeAddEntry: () => void;
}) {
  const [harvesting, setHarvesting] = useState(false);
  const [yoy, setYoy] = useState<YearPoint[] | null>(null);

  useEffect(() => {
    fetchYoYHistory(plot.id, cycle.crop_name).then((s) => setYoy(s ?? []));
  }, [plot.id, cycle.crop_name]);

  const handleHarvest = async () => {
    setHarvesting(true);
    const updated = await markCycleHarvested(cycle.id);
    setHarvesting(false);
    if (updated) {
      onCycleUpdated(updated);
    }
  };

  const netRunning = cycle.total_revenue - cycle.total_expenses;

  return (
    <ScreenBg>
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.backHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textDark} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{cycle.crop_name}</Text>
            {cycle.crop_name_kn && <Text style={styles.titleKn}>{cycle.crop_name_kn}</Text>}
            <Text style={styles.subtitle}>
              {plot.label} · sowed {cycle.sowing_date}
            </Text>
          </View>

          {/* Header-right action: Mark-harvested (GROWING) or Harvested badge (DONE) */}
          {cycle.status === 'GROWING' && (
            <TouchableOpacity
              style={styles.harvestPill}
              onPress={handleHarvest}
              disabled={harvesting}
              activeOpacity={0.85}
            >
              {harvesting
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <>
                    <MaterialCommunityIcons name="basket-outline" size={14} color={COLORS.bgCard} />
                    <Text style={styles.harvestPillText}>Harvest{'\n'}ಸುಗ್ಗಿ</Text>
                  </>
                )}
            </TouchableOpacity>
          )}
          {cycle.status === 'HARVESTED' && (
            <View style={styles.harvestedPill}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
              <Text style={styles.harvestedPillText}>Done{'\n'}ಮುಗಿದಿದೆ</Text>
            </View>
          )}
        </View>

        {/* KPI cards */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Income · ಆದಾಯ</Text>
            <Text style={[styles.kpiValue, { color: COLORS.primary }]}>
              {fmtIN(cycle.total_revenue)}
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Expenses · ಖರ್ಚು</Text>
            <Text style={[styles.kpiValue, { color: COLORS.accentRed }]}>
              {fmtIN(cycle.total_expenses)}
            </Text>
          </View>
          <View style={[styles.kpiCard, styles.netProfitCard]}>
            <Text style={[styles.kpiLabel, { color: 'rgba(255,255,255,0.8)' }]}>
              {cycle.status === 'HARVESTED' ? 'Final · ಅಂತಿಮ' : 'Running · ನಡೆಯುತ್ತಿದೆ'}
            </Text>
            <Text style={[styles.kpiValue, { color: '#fff' }]}>
              {netRunning >= 0 ? '+' : ''}{fmtIN(netRunning)}
            </Text>
            {cycle.roi_percent != null && (
              <Text style={styles.kpiRoi}>ROI {Math.round(cycle.roi_percent)}%</Text>
            )}
          </View>
        </View>

        {/* Harvested-date confirmation strip (only when done — keeps the
            date visible without a big button once the CTA moved to the header) */}
        {cycle.status === 'HARVESTED' && cycle.actual_harvest_date && (
          <View style={styles.harvestedDateStrip}>
            <Ionicons name="calendar-outline" size={14} color={COLORS.primary} />
            <Text style={styles.harvestedDateText}>
              Harvested on {cycle.actual_harvest_date} · ಸುಗ್ಗಿಯಾಗಿದೆ
            </Text>
          </View>
        )}

        {/* Add entry FAB row */}
        <TouchableOpacity
          style={styles.addEntryBtn}
          onPress={onAddEntry}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle" size={20} color={COLORS.primary} />
          <Text style={styles.addEntryBtnText}>
            Add expense or income · ಖರ್ಚು / ಆದಾಯ ಸೇರಿಸಿ
          </Text>
        </TouchableOpacity>

        {/* Year-over-year for this crop on this plot */}
        {yoy && yoy.length >= 2 && (
          <>
            <Text style={styles.sectionTitle}>ROI over years</Text>
            <Text style={styles.sectionTitleKn}>ವರ್ಷಗಳಲ್ಲಿ ROI</Text>
            <YearOverYearChart data={yoy} />
          </>
        )}
      </ScrollView>

      <AddEntryModal
        visible={showAddEntry}
        onClose={closeAddEntry}
        cycleId={cycle.id}
        onEntryAdded={(c) => { closeAddEntry(); onCycleUpdated(c); }}
      />
    </SafeAreaView>
    </ScreenBg>
  );
}

function YearOverYearChart({ data }: { data: YearPoint[] }) {
  const rois = data.map(d => d.roi_percent).filter((v): v is number => v != null);
  if (rois.length === 0) return null;
  const max = Math.max(...rois, 100);
  const min = Math.min(...rois, 0);
  const range = Math.max(max - min, 1);

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartArea}>
        {data.map((p, i) => {
          const h = p.roi_percent == null ? 4 : Math.max(4, ((p.roi_percent - min) / range) * 100);
          const color =
            p.roi_percent == null ? COLORS.textMuted
              : p.roi_percent >= 100 ? COLORS.primary
              : p.roi_percent >= 0   ? '#D97706'
              : COLORS.accentRed;
          return (
            <View key={i} style={styles.chartCol}>
              <Text style={styles.chartVal}>
                {p.roi_percent == null ? '—' : `${Math.round(p.roi_percent)}%`}
              </Text>
              <View style={[styles.chartBar, { height: h, backgroundColor: color }]} />
              <Text style={styles.chartYear}>{p.year}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════════════════════

function SlideModal({
  visible, onClose, children,
}: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const slideAnim = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
    } else {
      slideAnim.setValue(500);
    }
  }, [visible, slideAnim]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/*
        Keyboard handling notes:
        - On both platforms we use behavior="padding" so the sheet lifts.
          On Android, transparent modals don't get windowSoftInputMode
          resize behaviour by default, so relying on OS resize fails.
        - The sheet content is wrapped in a ScrollView with
          keyboardShouldPersistTaps="handled" so tapping a chip / button
          while the keyboard is up doesn't dismiss + require a second tap.
        - keyboardVerticalOffset gives ~24px breathing room above the
          keyboard's top edge so the focused input isn't flush against it.
      */}
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <Animated.View style={[styles.modalSheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sheetHandle} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 12 }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NewPlotModal({
  visible, onClose, onCreated,
}: { visible: boolean; onClose: () => void; onCreated: (p: Plot) => void }) {
  const [label, setLabel] = useState('');
  const [labelKn, setLabelKn] = useState('');
  const [area, setArea] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Ref guard: rapid double-taps can fire submit() again before React
  // re-renders with the disabled button — a state setter is one frame
  // behind, a ref is synchronous. This is what was creating duplicate
  // "Chouddappa's land" plots on one tap.
  const inFlightRef = useRef(false);

  const submit = async () => {
    if (inFlightRef.current) return;
    const areaNum = parseFloat(area);
    if (!label.trim() || isNaN(areaNum) || areaNum <= 0) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const p = await createPlot({
        label: label.trim(),
        label_kn: labelKn.trim() || null,
        area_ha: areaNum,
      });
      if (p) {
        setLabel(''); setLabelKn(''); setArea('');
        onCreated(p);
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SlideModal visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>New plot · ಹೊಸ ಹೊಲ</Text>

      <Text style={styles.inputLabel}>Name (English)</Text>
      <TextInput style={styles.textInput} value={label} onChangeText={setLabel}
        placeholder="e.g. North field" placeholderTextColor={COLORS.textMuted} />

      <Text style={styles.inputLabel}>Name (Kannada — optional)</Text>
      <TextInput style={styles.textInput} value={labelKn} onChangeText={setLabelKn}
        placeholder="ಉದಾ. ಉತ್ತರದ ಹೊಲ" placeholderTextColor={COLORS.textMuted} />

      <Text style={styles.inputLabel}>Area (hectares · ಹೆಕ್ಟೇರ್)</Text>
      <TextInput style={styles.textInput} value={area} onChangeText={setArea}
        keyboardType="decimal-pad" placeholder="1.5" placeholderTextColor={COLORS.textMuted} />

      <TouchableOpacity
        style={[styles.submitBtn, (submitting || !label.trim() || !area.trim()) && styles.submitBtnDisabled]}
        onPress={submit}
        disabled={submitting || !label.trim() || !area.trim()}
        activeOpacity={0.85}
      >
        {submitting ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitBtnText}>Create · ರಚಿಸಿ</Text>}
      </TouchableOpacity>
    </SlideModal>
  );
}

function NewCycleModal({
  visible, onClose, onCreated, plotId,
}: { visible: boolean; onClose: () => void; onCreated: (c: CropCycle) => void; plotId: string }) {
  const [crop, setCrop] = useState('');
  const [cropKn, setCropKn] = useState('');
  const [sowing, setSowing] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const submit = async () => {
    if (inFlightRef.current) return;
    if (!crop.trim() || !sowing.trim()) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const c = await createCycle(plotId, {
        crop_name: crop.trim(),
        crop_name_kn: cropKn.trim() || null,
        sowing_date: sowing,
      });
      if (c) { setCrop(''); setCropKn(''); setSowing(todayISO()); onCreated(c); }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SlideModal visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>New cycle · ಹೊಸ ಋತು</Text>

      <Text style={styles.inputLabel}>Crop name</Text>
      <TextInput style={styles.textInput} value={crop} onChangeText={setCrop}
        placeholder="e.g. Tomato" placeholderTextColor={COLORS.textMuted} />

      <Text style={styles.inputLabel}>Kannada name (optional)</Text>
      <TextInput style={styles.textInput} value={cropKn} onChangeText={setCropKn}
        placeholder="ಉದಾ. ಟೊಮೇಟೊ" placeholderTextColor={COLORS.textMuted} />

      <Text style={styles.inputLabel}>Sowing date (YYYY-MM-DD)</Text>
      <TextInput style={styles.textInput} value={sowing} onChangeText={setSowing}
        placeholder="2026-08-26" placeholderTextColor={COLORS.textMuted} />

      <TouchableOpacity
        style={[styles.submitBtn, (submitting || !crop.trim()) && styles.submitBtnDisabled]}
        onPress={submit}
        disabled={submitting || !crop.trim()}
        activeOpacity={0.85}
      >
        {submitting ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitBtnText}>Start cycle · ಋತು ಪ್ರಾರಂಭಿಸಿ</Text>}
      </TouchableOpacity>
    </SlideModal>
  );
}

function AddEntryModal({
  visible, onClose, cycleId, onEntryAdded,
}: { visible: boolean; onClose: () => void; cycleId: string; onEntryAdded: (c: CropCycle) => void }) {
  const [kind, setKind] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [sub, setSub] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  const cats = kind === 'INCOME' ? INCOME_SUBCATEGORIES : EXPENSE_SUBCATEGORIES;

  const submit = async () => {
    if (inFlightRef.current) return;
    const n = parseFloat(amount);
    if (!sub || isNaN(n) || n <= 0) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const c = await addCycleEntry(cycleId, { kind, amount: n, subcategory: sub });
      if (c) { setSub(''); setAmount(''); onEntryAdded(c); }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SlideModal visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Add entry · ದಾಖಲೆ ಸೇರಿಸಿ</Text>

      <View style={styles.typeToggleRow}>
        <TouchableOpacity
          style={[styles.typeBtn, kind === 'EXPENSE' && styles.typeBtnExpenseActive]}
          onPress={() => { setKind('EXPENSE'); setSub(''); }} activeOpacity={0.8}
        >
          <Ionicons name="arrow-down" size={14} color={kind === 'EXPENSE' ? '#fff' : COLORS.accentRed} />
          <Text style={[styles.typeBtnText, kind === 'EXPENSE' && { color: '#fff' }]}>Expense</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeBtn, kind === 'INCOME' && styles.typeBtnIncomeActive]}
          onPress={() => { setKind('INCOME'); setSub(''); }} activeOpacity={0.8}
        >
          <Ionicons name="arrow-up" size={14} color={kind === 'INCOME' ? '#fff' : COLORS.primary} />
          <Text style={[styles.typeBtnText, kind === 'INCOME' && { color: '#fff' }]}>Income</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.inputLabel}>Category · ವರ್ಗ</Text>
      <View style={styles.chipsRow}>
        {cats.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, sub === c.key && styles.chipActive]}
            onPress={() => setSub(c.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, sub === c.key && styles.chipTextActive]}>
              {c.en}{'\n'}{c.kn}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.inputLabel}>Amount · ಮೊತ್ತ</Text>
      <View style={styles.amountInputRow}>
        <Text style={styles.rupeePrefix}>₹</Text>
        <TextInput
          style={styles.amountInput} value={amount} onChangeText={setAmount}
          keyboardType="numeric" placeholder="0" placeholderTextColor={COLORS.textMuted}
        />
      </View>

      <TouchableOpacity
        style={[
          styles.submitBtn,
          kind === 'EXPENSE' && styles.submitBtnExpense,
          (submitting || !sub || !amount.trim()) && styles.submitBtnDisabled,
        ]}
        onPress={submit}
        disabled={submitting || !sub || !amount.trim()}
        activeOpacity={0.85}
      >
        {submitting ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitBtnText}>
              Add {kind === 'INCOME' ? 'income' : 'expense'} · ಸೇರಿಸಿ
            </Text>}
      </TouchableOpacity>
    </SlideModal>
  );
}

function TransferInitModal({
  visible, onClose, plotId, plotLabel,
}: { visible: boolean; onClose: () => void; plotId: string; plotLabel: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && !code) {
      setLoading(true);
      initPlotTransfer(plotId, 'INHERITANCE').then((r) => {
        setLoading(false);
        if (r) setCode(r.claim_code);
      });
    }
    if (!visible) setCode(null);
  }, [visible, plotId, code]);

  return (
    <SlideModal visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Transfer {plotLabel}</Text>
      <Text style={styles.sheetSubtitle}>ಹೊಲ ವರ್ಗಾವಣೆ</Text>

      {loading && <ActivityIndicator style={{ marginVertical: 20 }} color={COLORS.primary} />}

      {code && (
        <>
          <Text style={styles.transferHelp}>
            Share this 6-character code with the person taking over this plot.
            They open KisanShakti → Business tab → Claim button, and enter it.
            All the cycle history moves with the plot to their account.{'\n\n'}
            ಈ ಸಂಕೇತವನ್ನು ಹೊಸ ಒಡೆಯನಿಗೆ ಕೊಡಿ. ಎಲ್ಲಾ ಇತಿಹಾಸ ವರ್ಗಾವಣೆಯಾಗುತ್ತದೆ.
          </Text>
          <View style={styles.claimCodeBox}>
            <Text style={styles.claimCode}>{code}</Text>
          </View>
          <Text style={styles.transferExpires}>Expires in 15 minutes · 15 ನಿಮಿಷಗಳಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ</Text>
        </>
      )}

      <TouchableOpacity style={styles.submitBtn} onPress={onClose} activeOpacity={0.85}>
        <Text style={styles.submitBtnText}>Done · ಮುಗಿಸಿ</Text>
      </TouchableOpacity>
    </SlideModal>
  );
}

function ClaimTransferModal({
  visible, onClose, onAccepted,
}: { visible: boolean; onClose: () => void; onAccepted: () => void }) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (code.trim().length !== 6) return;
    setSubmitting(true);
    setError(null);
    const r = await acceptPlotTransfer(code.trim());
    setSubmitting(false);
    if (r) {
      setCode('');
      onAccepted();
    } else {
      setError('Invalid or expired code · ಸಂಕೇತ ಸರಿಯಿಲ್ಲ');
    }
  };

  return (
    <SlideModal visible={visible} onClose={onClose}>
      <Text style={styles.sheetTitle}>Claim a plot · ಹೊಲವನ್ನು ಸ್ವೀಕರಿಸಿ</Text>
      <Text style={styles.transferHelp}>
        Enter the 6-character code shared by the previous owner. You'll instantly see
        every past cycle and expense they logged on this plot.
        {'\n\n'}
        ಹಿಂದಿನ ಒಡೆಯ ಹಂಚಿಕೊಂಡ 6-ಅಕ್ಷರದ ಸಂಕೇತವನ್ನು ನಮೂದಿಸಿ.
      </Text>
      <TextInput
        style={[styles.textInput, styles.codeInput]}
        value={code}
        onChangeText={(v) => { setCode(v.toUpperCase()); setError(null); }}
        placeholder="ABC123"
        placeholderTextColor={COLORS.textMuted}
        autoCapitalize="characters"
        maxLength={6}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
      <TouchableOpacity
        style={[styles.submitBtn, (submitting || code.length !== 6) && styles.submitBtnDisabled]}
        onPress={submit}
        disabled={submitting || code.length !== 6}
        activeOpacity={0.85}
      >
        {submitting ? <ActivityIndicator color="#fff" />
          : <Text style={styles.submitBtnText}>Accept transfer · ಸ್ವೀಕರಿಸಿ</Text>}
      </TouchableOpacity>
    </SlideModal>
  );
}

/**
 * Delete-plot modal.
 *
 * Two modes, chosen by the plot's data footprint:
 *   Light  (0 cycles)     → single-tap Delete. Nothing precious to lose.
 *   Strict (≥1 cycles)    → shows count + requires the farmer to type
 *                            "DELETE" before the button enables. Guards
 *                            against tapping trash accidentally on a plot
 *                            with real season history.
 *
 * Threshold rationale: even ONE completed cycle represents real work
 * logged over weeks — losing it silently would breach the farmer's trust
 * in the app. If they created a plot to try things out and never logged a
 * cycle, that's throwaway and shouldn't need a gate.
 */
function DeletePlotModal({
  visible, onClose, plot, cyclesCount, onDeleted,
}: {
  visible: boolean; onClose: () => void;
  plot: Plot; cyclesCount: number;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!visible) { setTyped(''); setError(null); }
  }, [visible]);

  const strict = cyclesCount > 0;
  const canDelete = strict ? typed.trim().toUpperCase() === 'DELETE' : true;

  const submit = async () => {
    if (inFlightRef.current || !canDelete) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const r = await deletePlot(plot.id, strict ? { confirm: 'DELETE' } : {});
      if (r) {
        onDeleted();
      } else {
        setError('Could not delete — check connection · ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ');
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <SlideModal visible={visible} onClose={onClose}>
      <View style={styles.deleteHeader}>
        <View style={styles.deleteIconRing}>
          <Ionicons name="trash-outline" size={22} color={COLORS.accentRed} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetTitle}>Delete "{plot.label}"?</Text>
          <Text style={styles.sheetSubtitle}>ಹೊಲ ಅಳಿಸಿ?</Text>
        </View>
      </View>

      {!strict ? (
        <Text style={styles.deleteBody}>
          This plot has no cycles yet — safe to remove.{'\n'}
          ಈ ಹೊಲದಲ್ಲಿ ಇನ್ನೂ ಋತು ಇಲ್ಲ — ಅಳಿಸಬಹುದು.
        </Text>
      ) : (
        <>
          <View style={styles.deleteWarnCard}>
            <Ionicons name="warning" size={18} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.deleteWarnTitle}>
                {cyclesCount} {cyclesCount === 1 ? 'cycle' : 'cycles'} will be permanently deleted
              </Text>
              <Text style={styles.deleteWarnBody}>
                All expenses, income and ROI history on this plot will be lost.
                This cannot be undone.{'\n'}
                ಎಲ್ಲಾ ಇತಿಹಾಸ ಶಾಶ್ವತವಾಗಿ ಅಳಿಸಲ್ಪಡುತ್ತದೆ.
              </Text>
            </View>
          </View>

          <Text style={styles.inputLabel}>
            Type DELETE to confirm · ಖಾತ್ರಿಗಾಗಿ DELETE ಟೈಪ್ ಮಾಡಿ
          </Text>
          <TextInput
            style={[styles.textInput, styles.codeInput, { fontSize: 16, letterSpacing: 3 }]}
            value={typed}
            onChangeText={(v) => { setTyped(v); setError(null); }}
            autoCapitalize="characters"
            placeholder="DELETE"
            placeholderTextColor={COLORS.textMuted}
          />
        </>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TouchableOpacity
          style={[styles.submitBtn, { flex: 1, backgroundColor: COLORS.bgSubtle }]}
          onPress={onClose}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={[styles.submitBtnText, { color: COLORS.textDark }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { flex: 1, backgroundColor: COLORS.accentRed },
            (submitting || !canDelete) && styles.submitBtnDisabled,
          ]}
          onPress={submit}
          disabled={submitting || !canDelete}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitBtnText}>Delete · ಅಳಿಸಿ</Text>}
        </TouchableOpacity>
      </View>
    </SlideModal>
  );
}

function LoadingScaffold() {
  return (
    <ScreenBg>
    <SafeAreaView style={styles.safe}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    </SafeAreaView>
    </ScreenBg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Transparent so the ImageBackground wrapper (ScreenBg) shows through.
  // The soft white veil inside ScreenBg gives text on the sky area the
  // contrast it needs without hiding the illustration entirely.
  safe:   { flex: 1, backgroundColor: 'transparent' },
  // Business/Profits-tab background — ImageBackground wraps each screen so
  // the illustration renders reliably behind all content on both platforms.
  bgRoot:  { flex: 1, backgroundColor: COLORS.bgApp },
  bgImage: { opacity: 1 },
  // Soft white veil above the image, under the content. Keeps text and card
  // colors legible without washing out the illustration completely.
  bgVeil:  { flex: 1, backgroundColor: 'rgba(255,255,255,0.78)' },
  scroll: { padding: SPACING.xl, paddingBottom: 120 },

  // Header
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACING.lg, gap: 12 },
  title:    { fontSize: 20, fontWeight: '800', color: COLORS.textDark },
  titleKn:  { fontSize: 14, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  subtitle: { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  backHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: SPACING.lg },
  backBtn:  { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.bgCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  transferIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  acceptTransferPill: { backgroundColor: '#DCFCE7', borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  acceptTransferText: { fontSize: 10, fontWeight: '700', color: COLORS.primary, lineHeight: 12 },

  // Empty card
  emptyCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.xl, padding: SPACING.xl, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  emptyIconRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle:   { fontSize: 17, fontWeight: '800', color: COLORS.textDark },
  emptyTitleKn: { fontSize: 14, fontWeight: '700', color: COLORS.textBody },
  emptyMsg:     { fontSize: 12, color: COLORS.textBody, textAlign: 'center', lineHeight: 17, marginTop: 6 },
  emptyMsgKn:   { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', lineHeight: 15 },
  emptyCta:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: RADII.pill, marginTop: 12 },
  emptyCtaText: { color: COLORS.bgCard, fontWeight: '700', fontSize: 14 },
  emptySmall:   { padding: SPACING.lg, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  emptySmallText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  // Plot card — strip + body layout
  plotCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard, borderRadius: RADII.lg,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10, overflow: 'hidden',
    ...SHADOWS.card,
  },
  plotStrip:   { width: 5, alignSelf: 'stretch' },
  plotCardBody:{ flex: 1, padding: SPACING.md },
  plotCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  plotIconRing:{
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#DCFCE7',
    alignItems: 'center', justifyContent: 'center',
  },
  plotLabel:   { fontSize: 16, fontWeight: '800', color: COLORS.textDark },
  plotLabelKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },
  plotArea:    { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },
  activeCycleBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    gap: 6, backgroundColor: '#DCFCE7', borderRadius: RADII.pill,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 10,
  },
  activeCycleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  activeCycleText: { fontSize: 11, color: COLORS.primaryDark, fontWeight: '700' },
  idleBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    gap: 4, backgroundColor: COLORS.bgSubtle, borderRadius: RADII.pill,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 10,
  },
  idleBadgeText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  plotRoiRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  plotRoiLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  plotRoiValue: { fontSize: 18, fontWeight: '800' },
  addPlotBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#DCFCE7', borderRadius: RADII.pill, paddingVertical: 12, marginTop: 8, borderWidth: 1, borderColor: '#BBF7D0' },
  addPlotBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },

  // Delete-plot modal
  deleteIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' },
  deleteHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SPACING.md },
  deleteIconRing:{
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center',
  },
  deleteBody:    { fontSize: 13, color: COLORS.textBody, lineHeight: 19, marginBottom: SPACING.md },
  deleteWarnCard:{
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: '#FEF3C7', borderRadius: RADII.md,
    padding: SPACING.md, borderWidth: 1, borderColor: '#FDE68A',
    marginBottom: SPACING.md,
  },
  deleteWarnTitle: { fontSize: 12, fontWeight: '800', color: '#92400E' },
  deleteWarnBody:  { fontSize: 11, color: '#78350F', marginTop: 4, lineHeight: 15 },

  // Summary card
  summaryCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.xl, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg, ...SHADOWS.card },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.md },
  summaryLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700' },
  summaryValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  summaryStats: { alignItems: 'center', paddingLeft: SPACING.md, borderLeftWidth: 1, borderLeftColor: COLORS.borderLight },
  summaryStatNum: { fontSize: 22, fontWeight: '800', color: COLORS.textDark },
  summaryStatLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', textAlign: 'center' },
  summaryEmpty: { paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  summaryEmptyText: { fontSize: 11, color: COLORS.textMuted, lineHeight: 16 },
  summaryBadges: { flexDirection: 'row', gap: 8, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  summaryBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: RADII.md, borderWidth: 1 },
  summaryBadgeGood: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  summaryBadgeBad:  { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  summaryBadgeLabel: { fontSize: 9, fontWeight: '700', color: COLORS.textMuted },
  summaryBadgeCrop:  { fontSize: 12, fontWeight: '800', color: COLORS.textDark, marginTop: 1 },

  // Section header
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md, marginTop: SPACING.md, gap: 8 },
  sectionTitle:  { fontSize: 15, fontWeight: '800', color: COLORS.textDark },
  sectionTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody, marginTop: 1 },

  // Month picker
  monthPill: { backgroundColor: COLORS.bgCard, borderRadius: RADII.pill, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.border },
  monthPillText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  monthOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  monthGrid: { width: 260, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6, ...SHADOWS.popover },
  monthCell: { width: 56, paddingVertical: 12, borderRadius: RADII.md, backgroundColor: COLORS.bgSubtle, alignItems: 'center' },
  monthCellActive: { backgroundColor: COLORS.primaryDark },
  monthCellText: { fontSize: 12, fontWeight: '700', color: COLORS.textDark },
  monthCellTextActive: { color: '#fff' },

  // Recommendations
  recCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  recIntro: { fontSize: 11, color: COLORS.textMuted, marginBottom: 12, fontStyle: 'italic' },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  recRank: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  recRankText: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted },
  recCrop:   { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  recCropKn: { fontSize: 11, fontWeight: '700', color: COLORS.textBody },
  recMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  recMeta:   { fontSize: 10, color: COLORS.textMuted },
  recVarPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADII.pill, backgroundColor: '#FEF3C7' },
  recVarText: { fontSize: 9, fontWeight: '700', color: '#B45309' },
  recRoi:    { fontSize: 18, fontWeight: '800' },
  recEmptyIcon: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  recEmptyTitle: { fontSize: 15, fontWeight: '800', color: COLORS.textDark, textAlign: 'center' },
  recEmptyTitleKn: { fontSize: 12, fontWeight: '700', color: COLORS.textBody, textAlign: 'center', marginTop: 1, marginBottom: 8 },
  recEmptyMsg:  { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', lineHeight: 17 },

  // Cycles
  newCycleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADII.pill },
  newCycleBtnText: { color: COLORS.bgCard, fontWeight: '700', fontSize: 11 },
  cycleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: SPACING.md, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  cycleStatusStrip: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  cycleCrop:   { fontSize: 14, fontWeight: '800', color: COLORS.textDark },
  cycleCropKn: { fontSize: 11, fontWeight: '700', color: COLORS.textBody },
  cycleMeta:   { fontSize: 10, color: COLORS.textMuted, marginTop: 3 },
  cycleStatus: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  cycleRoi:    { fontSize: 18, fontWeight: '800' },
  cycleRunning:{ fontSize: 10, fontWeight: '700', color: COLORS.textMuted, textAlign: 'right', lineHeight: 14 },

  // KPI + harvest
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  kpiCard: { flex: 1, backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, ...SHADOWS.card },
  netProfitCard: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  kpiLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '700' },
  kpiValue: { fontSize: 16, fontWeight: '800', marginVertical: 4 },
  kpiRoi:   { fontSize: 10, color: '#A7F3D0', fontWeight: '700' },
  // Header-right harvest CTA
  harvestPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADII.pill,
    ...SHADOWS.card,
  },
  harvestPillText: { color: COLORS.bgCard, fontWeight: '800', fontSize: 11, lineHeight: 13 },
  harvestedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  harvestedPillText: { fontSize: 10, fontWeight: '800', color: COLORS.primary, lineHeight: 12 },
  harvestedDateStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADII.md,
    marginBottom: SPACING.md,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  harvestedDateText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  addEntryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#DCFCE7', paddingVertical: 12, borderRadius: RADII.pill, marginBottom: SPACING.lg, borderWidth: 1, borderColor: '#BBF7D0' },
  addEntryBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },

  // YoY chart
  chartCard: { backgroundColor: COLORS.bgCard, borderRadius: RADII.lg, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md, ...SHADOWS.card },
  chartArea: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 140, paddingTop: 20 },
  chartCol: { flex: 1, alignItems: 'center' },
  chartVal: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', marginBottom: 6 },
  chartBar: { width: '80%', borderRadius: 4, minHeight: 4 },
  chartYear: { fontSize: 10, color: COLORS.textMuted, fontWeight: '700', marginTop: 6 },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: RADII.xl, borderTopRightRadius: RADII.xl,
    padding: SPACING.xl, paddingBottom: 40,
    // Cap so a keyboard-lifted sheet doesn't push its handle off the top
    // of a small phone. 88% of the screen leaves the status bar visible.
    maxHeight: '88%',
    ...SHADOWS.popover,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.borderDark, alignSelf: 'center', marginBottom: SPACING.lg },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textDark, marginBottom: 4 },
  sheetSubtitle: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600', marginBottom: SPACING.lg },
  inputLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginBottom: 6, marginTop: 8 },
  textInput: {
    backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADII.md, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: COLORS.textDark, marginBottom: 4,
  },
  codeInput: { fontSize: 22, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },

  // Type toggle
  typeToggleRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.md },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: RADII.pill, backgroundColor: COLORS.bgSubtle, borderWidth: 1, borderColor: COLORS.border },
  typeBtnIncomeActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  typeBtnExpenseActive: { backgroundColor: COLORS.accentRed, borderColor: '#B91C1C' },
  typeBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.textDark },

  // Chips
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: SPACING.md },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADII.md, backgroundColor: COLORS.bgSubtle, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  chipText: { fontSize: 11, fontWeight: '600', color: COLORS.textDark, textAlign: 'center', lineHeight: 14 },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  // Amount input
  amountInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgInput, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.md, paddingHorizontal: 14, marginBottom: SPACING.lg },
  rupeePrefix: { fontSize: 20, fontWeight: '800', color: COLORS.textDark, marginRight: 8 },
  amountInput: { flex: 1, fontSize: 20, fontWeight: '800', color: COLORS.textDark, paddingVertical: 12 },

  // Submit
  submitBtn: { backgroundColor: COLORS.primaryDark, borderRadius: RADII.pill, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  submitBtnExpense: { backgroundColor: COLORS.accentRed },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: COLORS.bgCard },

  // Transfer
  transferHelp:  { fontSize: 12, color: COLORS.textBody, lineHeight: 18, marginBottom: SPACING.md },
  claimCodeBox:  { backgroundColor: COLORS.primaryDark, padding: SPACING.lg, borderRadius: RADII.lg, alignItems: 'center', marginBottom: 8 },
  claimCode:     { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: 8 },
  transferExpires: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginBottom: SPACING.md },
  errorText:     { fontSize: 12, color: COLORS.accentRed, marginTop: 4, marginBottom: 8, textAlign: 'center' },
});
