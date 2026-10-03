/**
 * Babel config for Mandi.
 *
 * REQUIRED because Mandi's login screen uses react-native-reanimated
 * worklets (`useSharedValue`, `useAnimatedStyle`). Reanimated 4.x needs
 * `react-native-worklets/plugin` to compile those functions — without it,
 * the reanimated native module fails at boot on an APK build and the app
 * crashes silently (icon does nothing when tapped).
 *
 * `babel-preset-expo` covers everything else Expo needs.
 *
 * IMPORTANT: `react-native-worklets/plugin` MUST be the last plugin in
 * the list — the plugin scans transformed output, so anything added after
 * it won't be worklet-processed.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-worklets/plugin',
    ],
  };
};
