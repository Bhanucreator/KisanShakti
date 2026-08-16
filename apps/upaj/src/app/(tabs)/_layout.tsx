/**
 * Bottom tab layout — floating pill navbar per uisample/Navbar.png reference.
 * Dark rounded container floating above content with a raised primary FAB
 * for the Disease scan (center action).
 */

import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  navBg: '#0F1F17',
  navBgActive: '#1B4332',
  primary: '#2D6A4F',
  primaryBright: '#52B788',
  active: '#FFFFFF',
  inactive: '#7A8B85',
  fabPrimary: '#40916C',
  fabPrimaryTop: '#52B788',
  card: '#FFFFFF',
};

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
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

// ── Icon per route ──────────────────────────────────────────────────────────
function TabIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? C.active : C.inactive;
  const size = 20;
  switch (name) {
    case 'index':
      return <Ionicons name={active ? 'home' : 'home-outline'} size={size} color={color} />;
    case 'market':
      return <Feather name="shopping-bag" size={size} color={color} />;
    case 'disease':
      return <MaterialCommunityIcons name="line-scan" size={26} color="#FFFFFF" />;
    case 'weather':
      return <Ionicons name={active ? 'partly-sunny' : 'partly-sunny-outline'} size={size} color={color} />;
    case 'ledger':
      return <Feather name="pie-chart" size={size} color={color} />;
    default:
      return null;
  }
}

// ── Floating Tab Bar ────────────────────────────────────────────────────────
function FloatingTabBar({ state, navigation }: any) {
  const routes = state.routes;
  const activeIndex = state.index;

  return (
    <View pointerEvents="box-none" style={s.wrap}>
      <View style={s.pill}>
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

          // Center FAB (scan)
          if (isFab) {
            return (
              <Pressable key={route.key} onPress={onPress} style={s.fabWrap}>
                <View style={s.fabRing}>
                  <View style={s.fab}>
                    <TabIcon name={route.name} active={isActive} />
                  </View>
                </View>
              </Pressable>
            );
          }

          // Regular tab
          return (
            <Pressable key={route.key} onPress={onPress} style={s.tab}>
              {isActive ? (
                <View style={s.activePill}>
                  <TabIcon name={route.name} active />
                  <Text style={s.activeLabel} numberOfLines={1}>
                    {getLabel(route.name)}
                  </Text>
                </View>
              ) : (
                <TabIcon name={route.name} active={false} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function getLabel(name: string): string {
  switch (name) {
    case 'index':   return 'Home';
    case 'market':  return 'Market';
    case 'weather': return 'Weather';
    case 'ledger':  return 'Ledger';
    default:        return '';
  }
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16, right: 16,
    bottom: Platform.OS === 'ios' ? 24 : 14,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.navBg,
    borderRadius: 32,
    paddingHorizontal: 8,
    paddingVertical: 10,
    width: '100%',
    maxWidth: 380,
    // shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 14,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    minWidth: 40,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.navBgActive,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  activeLabel: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  fabWrap: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabRing: {
    width: 56, height: 56,
    borderRadius: 28,
    backgroundColor: C.navBg,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -22,
    borderWidth: 3, borderColor: C.navBg,
  },
  fab: {
    width: 48, height: 48,
    borderRadius: 24,
    backgroundColor: C.fabPrimary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.fabPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 10,
    elevation: 8,
  },
});
