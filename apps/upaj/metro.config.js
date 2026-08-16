const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ── Binary asset extensions ───────────────────────────────────────────────
config.resolver.assetExts.push('tflite', 'db');

// ── Stub native-only modules only when running in Expo Go ─────────────────
// EAS_BUILD=true is set automatically by EAS Build servers.
// EXPO_GO=1 can be set manually for local Expo Go testing.
// When neither is set and we're not in CI, assume Expo Go for local dev.
const isEasBuild = process.env.EAS_BUILD === 'true';

if (!isEasBuild) {
  // In Expo Go, native packages aren't bundled — swap with TypeScript stubs
  // that expose the same API surface with mock/demo data.
  const STUBS = {
    'react-native-fast-tflite': path.resolve(
      __dirname,
      'src/mocks/react-native-fast-tflite.ts',
    ),
    'react-native-nitro-modules': path.resolve(
      __dirname,
      'src/mocks/react-native-nitro-modules.ts',
    ),
    'react-native-ble-plx': path.resolve(
      __dirname,
      'src/mocks/react-native-ble-plx.ts',
    ),
  };

  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    ...STUBS,
  };
}

module.exports = config;
