const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ── Binary asset extensions ───────────────────────────────────────────────
config.resolver.assetExts.push('tflite', 'db');

// ── Stub native-only modules so the app runs in Expo Go ──────────────────
// In a real dev build these native packages are used; in Expo Go we swap them
// for TypeScript stubs that expose the same API surface with mock data.
const STUBS = {
  'react-native-fast-tflite': path.resolve(
    __dirname,
    'src/mocks/react-native-fast-tflite.ts',
  ),
  // react-native-nitro-modules is required by fast-tflite — stub it too
  'react-native-nitro-modules': path.resolve(
    __dirname,
    'src/mocks/react-native-nitro-modules.ts',
  ),
  // react-native-ble-plx cannot run in Expo Go either
  'react-native-ble-plx': path.resolve(
    __dirname,
    'src/mocks/react-native-ble-plx.ts',
  ),
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  ...STUBS,
};

module.exports = config;
