/**
 * Bottom tab layout — floating glassmorphic navbar.
 * Frosted-glass pill floating above content with a raised primary FAB
 * for the Disease scan (center action). Icons only, no labels.
 */

import { Tabs } from 'expo-router';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { SafeBlur as BlurView } from '../../components/safe-gradient';

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  primary: '#2D6A4F',
  primaryBright: '#40916C',
  primaryNeon: '#52B788',
  primaryDark: '#1B4332',
  active: '#1B4332',
  inactive: '#6B7A73',
  glassBg: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.75)',
  activePillBg: 'rgba(45,106,79,0.18)',
  activePillBorder: 'rgba(45,106,79,0.45)',
};

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"   options={{ title: 'Home' }} />
      <Tabs.Screen name="market"  options={{ title: 'Market' }} />
      <Tabs.Screen name="disease" options={{ title: 'Scan' }} />
      <Tabs.Screen name="weather" options={{ title: 'Weather' }} />
      <Tabs.Screen name="ledger"  options={{ title: 'Ledger' }} />
    </Tabs>
  );
}

// ── Icon per route ─────────────────────────────────────────────────────────
function TabIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? C.active : C.inactive;
  const size = 22;
  switch (name) {
    case 'index':
      return <Ionicons name={active ? 'home' : 'home-outline'} size={size} color={color} />;
    case 'market':
      return <Feather name="shopping-bag" size={size} color={color} />;
    case 'disease':
      return <MaterialCommunityIcons name="line-scan" size={28} color="#FFFFFF" />;
    case 'weather':
      return <Ionicons name={active ? 'partly-sunny' : 'partly-sunny-outline'} size={size} color={color} />;
    case 'ledger':
      return <Feather name="pie-chart" size={size} color={color} />;
    default:
      return null;
  }
}

// ── Glass Tab Bar ──────────────────────────────────────────────────────────
function GlassTabBar({ state, navigation }: any) {
  const routes = state.routes;
  const activeIndex = state.index;

  return (
    <View pointerEvents="box-none" style={s.wrap}>
      {/*
        Frosted-glass backdrop is its own clipped layer. FAB sits in a
        SEPARATE overlay layer above it, so its -22 marginTop is no longer
        cut by the pill's overflow:hidden.
      */}
      <View style={s.pillShell} pointerEvents="box-none">
        <BlurView intensity={40} tint="light" style={s.pillBackdrop}>
          <View style={s.pillOverlay} pointerEvents="none" />
        </BlurView>

        <View style={s.pillContent}>
          {routes.map((route: any, i: number) => {
            const isActive = i === activeIndex;
            const isFab = route.name === 'disease';

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress', target: route.key, canPreventDefault: true,
              });
              if (!isActive && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            };

            // FAB slot — reserve the space but render the actual FAB
            // outside the clipped shell, so it can pop above the navbar.
            if (isFab) return <View key={route.key} style={s.fabSlot} />;

            return (
              <Pressable key={route.key} onPress={onPress} style={s.tab}>
                <View style={isActive ? s.activePill : s.inactiveIconWrap}>
                  <TabIcon name={route.name} active={isActive} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* FAB — floats above the shell, un-clipped */}
      <Pressable
        onPress={() => {
          const fab = routes.find((r: any) => r.name === 'disease');
          if (fab) navigation.navigate('disease' as never);
        }}
        style={s.fabWrap}
      >
        <View style={s.fabRing}>
          <View style={s.fab}>
            <TabIcon name="disease" active={false} />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const NAV_H = 62;
const FAB_SIZE = 56;

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16, right: 16,
    bottom: Platform.OS === 'ios' ? 24 : 14,
    alignItems: 'center',
    height: NAV_H + 16,      // just enough headroom for the FAB to peek
    justifyContent: 'flex-end',
  },

  // Outer shell — hosts the frosted backdrop (clipped) + content row.
  pillShell: {
    width: '100%', maxWidth: 380, height: NAV_H,
    borderRadius: NAV_H / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  pillBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: NAV_H / 2, overflow: 'hidden',
    borderWidth: 1, borderColor: C.glassBorder,
    backgroundColor: C.glassBg,   // no-blur fallback
  },
  pillOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  pillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44, minWidth: 44,
  },
  activePill: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.activePillBg,
    borderWidth: 1, borderColor: C.activePillBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  inactiveIconWrap: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },

  // FAB placeholder in the row (keeps the icon layout symmetric)
  fabSlot: { width: FAB_SIZE + 8, height: 44 },

  // Real FAB — rendered outside the clipped shell so nothing gets cut
  fabWrap: {
    position: 'absolute',
    // Sit the FAB so only ~12 px pokes above the pill — matches reference
    bottom: NAV_H - FAB_SIZE + 10,
    alignSelf: 'center',
    width: FAB_SIZE + 12, height: FAB_SIZE + 12,
    alignItems: 'center', justifyContent: 'center',
  },
  fabRing: {
    width: FAB_SIZE + 8, height: FAB_SIZE + 8,
    borderRadius: (FAB_SIZE + 8) / 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 12,
  },
  fab: {
    width: FAB_SIZE, height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
});
