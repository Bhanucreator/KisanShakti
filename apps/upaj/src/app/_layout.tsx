import '../global.css';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '../hooks/use-auth';
import { startSoilMoistureWatcher } from '../lib/soil-alert';

SplashScreen.preventAutoHideAsync();

export default function UpajRootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const auth = useAuth();
  const redirected = useRef(false);

  const ready = fontsLoaded && !auth.isLoading;

  // Start the soil-moisture push watcher once — subscribes to the sensor
  // bus and fires an Android tray notification whenever the BLE-connected
  // ESP32 reports moisture dropping below the dry threshold.
  useEffect(() => { startSoilMoistureWatcher(); }, []);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync();

    if (redirected.current) return;
    redirected.current = true;

    // Only enter the app when both signed in AND onboarding is complete
    if (auth.isAuthenticated && auth.isOnboarded) {
      router.replace('/(tabs)');
    } else {
      router.replace('/login');
    }
  }, [ready, auth.isAuthenticated, auth.isOnboarded]);

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingDot} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="login"
        options={{
          headerShown: false,
          animation: 'none',
        }}
      />
      {/* Legal screens — Play Store review requires these to be reachable
          in-app AND from the store listing URL. */}
      <Stack.Screen name="legal/terms" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="legal/privacy" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1B4332',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#52B788',
  },
});
