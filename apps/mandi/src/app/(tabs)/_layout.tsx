import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { Ionicons, FontAwesome5, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';

export default function MandiTabsLayout() {
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
          title: 'Discover',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'storefront' : 'storefront-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
