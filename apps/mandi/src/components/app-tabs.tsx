import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor="#F8F9FA"
      indicatorColor="#1B4332"
      labelStyle={{ selected: { color: '#1B4332' } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
