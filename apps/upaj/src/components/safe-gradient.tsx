/**
 * SafeGradient / SafeBlur
 * ────────────────────────
 * Drop-in replacements for `expo-linear-gradient` / `expo-blur` that gracefully
 * fall back to a solid-color View when the native view manager isn't registered
 * in the installed APK (e.g. dev-client built before the packages were added).
 *
 * Both packages are pure JS on the import side but need native view managers at
 * render time. We check `UIManager.hasViewManagerConfig(name)` at module load
 * to decide whether the native side is available.
 */

import React from 'react';
import { View, ViewProps, StyleProp, ViewStyle, UIManager, Platform } from 'react-native';

// ── Native availability probe (runs once at module load) ────────────────────
function hasNativeView(name: string): boolean {
  try {
    // On Android + iOS the config lookup returns null when unregistered
    const cfg = (UIManager as any).getViewManagerConfig?.(name);
    return !!cfg;
  } catch {
    return false;
  }
}

// The Expo native view names (Fabric adapter names)
const HAS_GRADIENT =
  hasNativeView('ExpoLinearGradient') ||
  hasNativeView('BVLinearGradient') || // legacy fallback name
  hasNativeView('ViewManagerAdapter_ExpoLinearGradient');

const HAS_BLUR =
  hasNativeView('ExpoBlurView') ||
  hasNativeView('BlurView') ||
  hasNativeView('ViewManagerAdapter_ExpoBlurView');

// ── Try to load the real modules only if native side is available ──────────
let LinearGradientImpl: any = null;
let BlurViewImpl: any = null;

if (HAS_GRADIENT) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LinearGradientImpl = require('expo-linear-gradient').LinearGradient;
  } catch {
    LinearGradientImpl = null;
  }
}

if (HAS_BLUR) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BlurViewImpl = require('expo-blur').BlurView;
  } catch {
    BlurViewImpl = null;
  }
}

// ── SafeGradient ─────────────────────────────────────────────────────────────

type Point = { x: number; y: number };

export interface SafeGradientProps extends ViewProps {
  colors: readonly [string, string, ...string[]];
  start?: Point;
  end?: Point;
  locations?: number[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function SafeGradient({
  colors, start, end, locations, style, children, ...rest
}: SafeGradientProps) {
  if (LinearGradientImpl) {
    return (
      <LinearGradientImpl
        colors={colors} start={start} end={end} locations={locations}
        style={style} {...rest}
      >
        {children}
      </LinearGradientImpl>
    );
  }
  // Fallback: use middle color of gradient as solid background
  const midColor = colors[Math.floor(colors.length / 2)] ?? colors[0];
  return (
    <View style={[style, { backgroundColor: midColor }]} {...rest}>
      {children}
    </View>
  );
}

// ── SafeBlur ─────────────────────────────────────────────────────────────────

export interface SafeBlurProps extends ViewProps {
  intensity?: number;
  tint?: 'light' | 'dark' | 'default' | 'systemMaterial';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  fallbackColor?: string;
}

export function SafeBlur({
  intensity, tint, style, children, fallbackColor, ...rest
}: SafeBlurProps) {
  if (BlurViewImpl) {
    return (
      <BlurViewImpl intensity={intensity} tint={tint} style={style} {...rest}>
        {children}
      </BlurViewImpl>
    );
  }
  const bg =
    fallbackColor ??
    (tint === 'dark' ? 'rgba(20, 30, 25, 0.95)' : 'rgba(255, 255, 255, 0.97)');
  return (
    <View style={[style, { backgroundColor: bg }]} {...rest}>
      {children}
    </View>
  );
}
