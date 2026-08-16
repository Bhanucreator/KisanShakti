import { Tabs } from 'expo-router';
import { Platform, Text, View, StyleSheet } from 'react-native';
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, RADII } from '../../constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.bgCard,
          borderTopWidth: 1,
          borderTopColor: COLORS.borderLight,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 88 : 66,
          elevation: 10,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="disease"
        options={{
          title: 'Disease',
          tabBarIcon: ({ focused, color }) => (
            <MaterialCommunityIcons
              name={focused ? 'scan-helper' : 'line-scan'}
              size={23}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: 'Market',
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.centerFab}>
              <Ionicons name="add" size={24} color={COLORS.textWhite} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="weather"
        options={{
          title: 'Weather',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'partly-sunny' : 'partly-sunny-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ledger"
        options={{
          title: 'Profit',
          tabBarIcon: ({ focused, color }) => (
            <FontAwesome5 name="chart-line" size={19} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centerFab: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
});
