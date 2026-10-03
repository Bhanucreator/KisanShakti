// NOTE: global.css (Tailwind/NativeWind) import was removed — Mandi does
// not use `className=` anywhere on native. Importing it in an APK without
// the required Babel+Metro NativeWind setup crashes the app synchronously
// at boot (that was the "icon does nothing" symptom on install). Every
// screen uses StyleSheet.create, so no visual regression.
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Inter_400Regular,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '../hooks/use-auth';

SplashScreen.preventAutoHideAsync();

export default function MandiRootLayout() {
  const auth = useAuth();

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const ready = fontsLoaded && !auth.isLoading;

  useEffect(() => {
    if (!ready) return;

    SplashScreen.hideAsync();

    if (auth.isAuthenticated) {
      router.replace('/(tabs)');
    } else {
      router.replace('/login');
    }
  }, [ready, auth.isAuthenticated]);

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
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="crop-detail" />
      {/* Legal screens — Play Store review requires these to be in-app. */}
      <Stack.Screen name="legal/terms" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="legal/privacy" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F59E0B',
  },
});
