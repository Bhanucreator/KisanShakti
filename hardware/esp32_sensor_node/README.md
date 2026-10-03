# ESP32 Field Sensor Node

Firmware for the optional KisanShakti field sensor. An ESP32-WROOM-32
reads soil moisture, temperature, humidity, and rain in the field.
Farmers see live readings on the Weather tab of the Upaj app — over BLE
when they're within ~10 m, and streamed via WiFi from anywhere else
when the sensor is at range of a router.

**Total bill of materials: ~₹800.** Assembly: 20 minutes. No PCB.

---

## Bill of materials

| Part | Approx. cost (INR) | Where |
|---|---|---|
| ESP32-WROOM-32 dev board (with built-in USB) | ₹350 | Robu.in, Amazon |
| DHT22 temperature + humidity sensor | ₹150 | Robu, Amazon |
| Capacitive Soil Moisture Sensor v1.2 | ₹120 | Robu, Amazon |
| LM393 Rain Drop sensor module | ₹80 | Robu, Amazon |
| 2× 100 kΩ resistors (battery divider, optional) | ₹5 | Any electronics shop |
| Micro-USB cable + 5 V USB power (or 3.7 V LiPo + boost) | ₹100 | Any |
| Small waterproof enclosure | ₹100 | Local hardware shop |
| Jumper wires | ₹50 | — |
| **Total** | **~₹955** | |

Add a 3.7 V 2000 mAh LiPo + TP4056 charger board (~₹200) if you want
untethered operation.

---

## Wiring

```
ESP32 pin         →  connected to
─────────────────────────────────
GPIO 4            →  DHT22 data pin  (+ 10 kΩ pull-up to 3V3)
GPIO 34 (ADC1_6)  →  LM393 rain sensor analog out
GPIO 35 (ADC1_7)  →  Capacitive soil moisture analog out
GPIO 33 (ADC1_5)  →  Battery+ via 100 kΩ ─┬─ 100 kΩ ─ GND   (optional)
                                          └─ (halves the voltage into ADC)
GPIO 0            →  built-in BOOT button — hold 5 s to factory reset
GPIO 2            →  built-in blue LED (status indicator)
3V3, 5V, GND      →  respective sensor VCC / GND pins
```

Any ESP32 dev board with a USB port and the standard pinout works. If
your board's built-in LED is on a different GPIO, edit `LED_PIN` at the
top of the `.ino`.

---

## Flash

You need:
- Arduino IDE 2.x — [download](https://www.arduino.cc/en/software)
- ESP32 board support — Boards Manager → "esp32" by Espressif → Install
- Libraries — Library Manager, install:
  - `DHT sensor library` by Adafruit
  - `ArduinoJson` (v6.x — the `.ino` uses v6 syntax; v7 requires
    `JsonDocument` refactor)

Steps:
1. Open `esp32_sensor_node.ino`
2. Tools → Board → **ESP32 Dev Module**
3. Tools → Port → pick the COM port that appears when you plug in
4. Click Upload. If it hangs at `Connecting......_____`, hold the BOOT
   button until upload starts, then release.
5. Open Serial Monitor at **115200 baud**. You should see:
   ```
   [BOOT] KisanShakti sensor v2 starting...
   [BOOT] device_id=KS-XXXXXXXX  url=  fid_set=no
   [BLE] Advertising as KisanShakti-ESP32
   [WiFi] No creds yet — waiting for pairing via BLE.
   [DEBUG] raw soil=... raw rain=... wifi=off  slot=-1
   ```

---

## Pair with the Upaj app

1. On the farmer's phone, open **Upaj → Weather tab**.
2. The BLE scan auto-fires on tab mount. Within ~10 s the app connects
   to `KisanShakti-ESP32`.
3. Tap the blue **Pair** button on the no-sensor hero card → wizard
   opens.
4. Enter up to 3 WiFi networks in priority order (home router first,
   phone hotspot as backup, etc.). Type a plot nickname ("Tomato plot").
5. Save → the app writes a JSON blob over BLE containing WiFi creds,
   backend URL, farmer_id, and a per-device auth token.
6. ESP32 saves everything to NVS, connects to WiFi, and POSTs its first
   reading to `<backend>/api/v1/sensor/reading` within a minute.

From that point the farmer sees live values on the Weather tab whether
they're at the field (BLE) or anywhere else (cloud poll).

---

## Configuration protocol (BLE → ESP32)

The ESP32 exposes a single characteristic with READ + WRITE + NOTIFY
under service UUID `4fafc201-1fb5-459e-8fcc-c5c9c331914b`,
characteristic UUID `beb5483e-36e1-4688-b7f5-ea07361b26a8`.

**Writes accept three JSON shapes:**

Full multi-network replace:
```json
{
  "networks":[
    {"ssid":"AirtelHome","pass":"password1"},
    {"ssid":"PhoneHotspot","pass":"password2"}
  ],
  "url":"https://api.kisanshakti.example.com",
  "fid":"<farmer uuid>",
  "tok":"<per-device token from PATCH /sensor/devices/{id}>"
}
```

Per-slot update (0–2):
```json
{"slot":1,"ssid":"NewSSID","pass":"newpass"}
```

Legacy single-slot shortcut (writes slot 0):
```json
{"ssid":"NewSSID","pass":"newpass"}
```

Any field left out preserves the existing NVS value. Empty password
for an already-saved SSID keeps the on-device password intact (so the
app can prefill SSIDs from a snapshot READ without ever seeing the
password).

**READ returns a snapshot of the current config** (SSIDs only,
passwords masked) so the Upaj app can prefill the Setup/Change WiFi
modal. The ESP32 refreshes this snapshot in the characteristic value
on every BLE client connect.

---

## Configuration protocol (WiFi → backend)

Every ~5 minutes the ESP32 POSTs to `<url>/api/v1/sensor/reading`:

```json
{
  "device_id":"KS-A7F3B2D1",
  "device_token":"a1b2c3...",
  "farmer_id":"…",
  "soil_moisture":42,
  "temperature":28.4,
  "humidity":65.1,
  "is_raining":false,
  "battery_v":3.87,
  "battery_pct":72
}
```

`battery_v` + `battery_pct` are only included when the voltage divider
is wired to GPIO 33. Backend accepts either.

The backend rate-limits this endpoint to 30 POSTs per minute per
`device_id` — a well-behaved ESP32 on a 5-minute cadence never brushes
the limit. Rejects with 401 if the `device_token` is missing or wrong
(once one has been issued).

---

## Reset (factory wipe)

Hold the **BOOT button** (GPIO 0) for 5 seconds. After ~500 ms the blue
LED starts slow-blinking; at 5 s it fast-blinks 10 times then the ESP32
reboots with everything wiped from NVS — WiFi, backend URL, farmer_id,
device_token. Farmer re-pairs from scratch via the Upaj wizard.

Use this if:
- The sensor was previously paired to a different farmer's account
- You changed the backend URL
- WiFi credentials in NVS are corrupted / wrong password loop
- You're selling or transferring the sensor

---

## Multi-WiFi failover

Up to 3 networks saved in slots 0/1/2. On boot the ESP32 tries them in
priority order with a 15-second timeout each. First one that
successfully associates wins. If all three fail, it retries the whole
list every 60 seconds while keeping BLE advertising up.

Typical setup for a farmer:
- **Slot 0:** home router (used 95 % of the time)
- **Slot 1:** phone hotspot (used when router is down; farmer opens
  hotspot on their phone before going to the field)
- **Slot 2:** neighbour's WiFi or village community WiFi (last resort)

---

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `[WiFi] Connect failed — will retry in 60s` | 5 GHz-only router, wrong password, WPA3-only | ESP32 is 2.4 GHz only + WPA2 preferred. Enable a 2.4 GHz SSID on the router. |
| `[HTTP] skip: backend url not set` | Farmer paired via BLE but the app never sent the backend URL | Re-open Upaj → Weather tab (silent auto-config sends URL on BLE connect) |
| `[HTTP] POST /reading → 401` | Device token mismatch | Factory reset + re-pair to get a fresh token |
| `[DHT22] Read error` | Loose wiring or missing pull-up | Check the 10 kΩ pull-up from data → 3V3 |
| Raw rain ADC hovers ~3400 in dry air | Humidity — dew on the strip | Firmware ignores <3000 to avoid this false positive; app additionally debounces 3 frames (~15 s) before flipping the "raining now" banner |

---

## Firmware source

Single file: [`esp32_sensor_node.ino`](esp32_sensor_node.ino). ~400
lines including comments. Written in Arduino C++ (no PlatformIO — kept
Arduino IDE-friendly so farmers or field engineers can tweak without a
toolchain).

Key modules inside:
- `loadConfig()` / `mergeAndSaveConfig()` — NVS read/write via
  `Preferences` library
- `tryConnectWifi()` — priority-ordered walk through the 3 slots
- `postReading()` — HTTPClient POST with token in body
- `bleNotify()` — 5-second live JSON push to any connected BLE client
- `publishSavedConfigForRead()` — snapshot on connect for the Upaj
  Setup/Change WiFi modal
- `checkResetButton()` — GPIO 0 hold-5s wipe

---

## Cadence knobs (top of the `.ino`)

```cpp
const unsigned long BLE_NOTIFY_INTERVAL   = 5000;         // 5 s live view
const unsigned long WIFI_POST_INTERVAL    = 60UL * 1000;  // 1 min while testing — bump to 5*60000 for prod
const unsigned long WIFI_RETRY_INTERVAL   = 60UL * 1000;  // 1 min reconnect
const unsigned long WIFI_CONNECT_TIMEOUT  = 15000;        // 15 s per slot
```

For production deployment: **change `WIFI_POST_INTERVAL` back to
`5UL * 60000`** (5 min) so a battery-powered sensor doesn't burn
through its charge in a day.
