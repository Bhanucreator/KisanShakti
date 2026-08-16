import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor="#F8F9FA"
      indicatorColor="#1B4332"
      labelStyle={{ selected: { color: '#1B4332' } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="weather">
        <NativeTabs.Trigger.Label>Weather</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      
      <NativeTabs.Trigger name="disease">
        <NativeTabs.Trigger.Label>Disease</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      
      <NativeTabs.Trigger name="market">
        <NativeTabs.Trigger.Label>Market</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ledger">
        <NativeTabs.Trigger.Label>Ledger</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
