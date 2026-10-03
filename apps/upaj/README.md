# Upaj — the farmer app · ಉಪಜ್

Kannada + English React Native app for smallholder farmers in Karnataka.
Built on Expo SDK 57 / RN 0.86. Works offline once the farmer has
onboarded (profile mirrored in local SQLite), syncs when the network
comes back.

Sister app: [Mandi](../mandi/README.md) (for buyers).
Backend: [../../backend/README.md](../../backend/README.md).

---

## Screens

| Tab | What it does |
|---|---|
| **Home** | Live mandi prices for the farmer's district (ranked by nearest APMC), weather, agri advisory, notifications feed, quick "add crop" CTA |
| **Business** | Per-plot farm ledger — income, expenses, harvest-time ROI per cycle, category-wise expense analytics |
| **Market** | Create + manage crop listings; review buyer offers; accept/reject; track delivery via 4-digit OTP; ratings from buyers |
| **Weather** | Live ESP32 sensor grid (soil moisture / temp / humidity / rainfall / battery), 7-day forecast, crop-stage-aware irrigation + spray-window advice, pair-a-new-sensor wizard, device switcher for multi-plot farmers |
| **Disease** | Snap a leaf photo → on-device TFLite (MobileNetV2, 38 classes, uint8 quantised) diagnoses in <300 ms → treatment guide from a bundled SQLite DB |

Plus:
- Multi-step onboarding wizard (language pick, phone OTP, name, plot GPS, crops)
- Profile modal with Terms, Privacy Policy, Delete-my-account
- System-tray push via `expo-notifications` for offer / delivery events

---

## Run in dev

```bash
npm install
export EXPO_PUBLIC_API_URL=http://10.0.2.2:8000    # Android emulator's alias for localhost
npx expo start --clear
# → press 'a' to open on the emulator, or scan the QR with Expo Go on a real phone
```

For a real phone on the same WiFi, set the env to your laptop's LAN IP:
```
export EXPO_PUBLIC_API_URL=http://192.168.1.5:8000
```
(and make sure your firewall allows port 8000 inbound).

For farmers on mobile data / different networks, you need the backend
behind a public URL — ngrok / Cloudflare Tunnel / Oracle. See
[../../backend/README.md](../../backend/README.md).

---

## Project layout

```
src/
├── app/                        # File-based routes (expo-router)
│   ├── _layout.tsx             # Root — auth gate + splash
│   ├── login.tsx               # OTP flow + onboarding wizard
│   ├── (tabs)/                 # 5 main tabs
│   │   ├── _layout.tsx         # Bottom tab bar
│   │   ├── index.tsx           # Home (large — profile modal, notifications, market prices, weather, advisory)
│   │   ├── ledger.tsx          # Business — plots + cycles + ledger + P&L
│   │   ├── market.tsx          # Sell dashboard
│   │   ├── weather.tsx         # Live sensor + advisory (largest file)
│   │   └── disease.tsx         # Camera + TFLite inference
│   └── legal/
│       ├── terms.tsx           # Bilingual Terms of Service
│       └── privacy.tsx         # Bilingual Privacy Policy
├── components/                 # Shared components (safe-gradient, animated icons)
├── constants/theme.ts          # Colors + spacing tokens
├── hooks/
│   ├── use-auth.ts             # Local SQLite-backed auth state
│   └── use-disease-detection.ts# TFLite model wrapper + leaf-gate + confidence-gate
└── lib/
    ├── api.ts                  # Every backend call — one place, one style
    ├── local-db.ts             # expo-sqlite tables for offline profile + crops + ledger
    ├── sensor-bus.ts           # Cross-screen singleton for the latest ESP32 frame
    └── soil-alert.ts           # Watches soil-moisture drops (dry < 30%, recovered ≥ 40%)
```

---

## The disease model

- 38-class MobileNetV2, quantised uint8, ~1.7 MB `.tflite` in `assets/models/`
- Runs on-device via `react-native-fast-tflite` — the leaf image **never
  leaves the phone**
- Two gates prevent bad predictions:
  - **Leaf gate** — refuses if the image doesn't look leafy (green
    fraction + edge density heuristics)
  - **Confidence gate** — refuses predictions below the class-specific
    calibrated threshold (from `backend/ai/_stress_test.py`)
- Treatment recommendations come from a bundled SQLite DB
  (`assets/disease_treatments.db`) — no network round-trip

---

## ESP32 pairing (Weather tab)

Farmer taps **Pair** on the no-sensor hero → 5-step wizard:
1. Welcome — plug in the sensor
2. Scanning BLE for `KisanShakti-ESP32`
3. WiFi + nickname (1-3 saved networks in priority order)
4. Sending config over BLE
5. Success — waits for first cloud reading to confirm

The wizard writes JSON over BLE:
```json
{
  "networks":[{"ssid":"AirtelHome","pass":"…"},…],
  "url":"https://your-backend.example.com",
  "fid":"<farmer uuid>",
  "tok":"<per-device auth token issued by /sensor/devices>"
}
```

Existing sensors get a **"Setup / change WiFi"** pill that shows the
current saved SSIDs (passwords masked over BLE for security) — farmer
can add/remove networks or replace the whole list.

Multi-plot farmers get a chip strip at the top of the Weather tab —
tap to scope readings to that specific sensor. Mismatch banner appears
when the BLE-connected chip differs from the selected one.

---

## Notes on the offline story

- `local-db.ts` mirrors the farmer profile + crops + ledger entries in
  `expo-sqlite`. Every write goes to local first, then attempts backend.
- On login, the auth flow first checks local SQLite — instant return
  if the farmer previously signed in on this device — then tries backend
  hydrate if network is available.
- Sign-out **clears** the local SQLite AND per-user AsyncStorage keys
  (disease last-scan cache, saved scan photos) so a family-shared phone
  doesn't leak one farmer's data to the next.

---

## Build APK for internal testing

Uses EAS (Expo Application Services) — free for hobby projects.

```bash
# One-time
npm install -g eas-cli
eas login

# Configure (creates eas.json — commit it)
eas build:configure

# Build APK (preview profile → shareable APK, not signed for Play)
eas build --profile preview --platform android
```

EAS bakes `EXPO_PUBLIC_API_URL` into the APK at build time — set a
**permanent public URL** in the env (or in `eas.json`'s
`preview.env.EXPO_PUBLIC_API_URL`) before building. If the URL changes
you need a new APK.

Share the resulting `.apk` link (from your EAS dashboard) via WhatsApp
/ Google Drive to farmers for install. On their phone they need to
allow "Install unknown apps" for WhatsApp/Chrome once, then tap the APK.

---

## Common gotchas

- **Expo SDK 57 changed how Metro finds modules.** If you edit a native
  dep, always `npx expo start --clear` (blank Metro cache) before
  running.
- **`react-native-ble-plx` needs runtime permissions on Android 12+**
  (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`). The
  Weather tab handles this on first pair attempt.
- **`10.0.2.2` is Android emulator-only.** Real phones on the same
  WiFi need your laptop's LAN IP; real phones on mobile data need a
  public tunnel.
