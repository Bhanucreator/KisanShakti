/*
 * KisanShakti ESP32 Sensor Node Firmware  v2
 * Hardware: ESP32-WROOM-32
 * Sensors:
 *   - Capacitive Soil Moisture Sensor v1.2 → GPIO 35 (ADC)
 *   - DHT22 (Temperature/Humidity)         → GPIO 4
 *   - Rain Drop Sensor (LM393)             → GPIO 34 (ADC)
 *
 * What's new in v2:
 *   1. Config is persisted to NVS (survives power loss).
 *      Stored: wifi_ssid, wifi_pass, backend_url, device_id, farmer_id.
 *   2. On boot, connects to saved WiFi (if any) and starts pushing readings
 *      to the backend every ~5 min so the farmer can see field state from
 *      anywhere on the internet.
 *   3. BLE keeps advertising in parallel so the farmer can (a) re-pair,
 *      (b) change WiFi later, or (c) see live 5-second readings when nearby.
 *   4. If WiFi drops mid-session, we auto-retry every minute without needing
 *      a power cycle. If WiFi never comes up (bad password, dead router),
 *      BLE pairing stays available forever.
 *
 * BLE JSON write payload (from Upaj):
 *   {
 *     "ssid": "AirtelHome_1A",
 *     "pass": "supersecret",
 *     "url":  "https://api.kisanshakti.example.com",
 *     "dev":  "KS-A7F3",
 *     "fid":  "<farmer uuid>"
 *   }
 *   Any field left out preserves the existing NVS value. So the app can
 *   push just {"ssid","pass"} to update WiFi without re-sending everything.
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <DHT.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// ─── Pin Definitions ───────────────────────────────────────────────────
#define SOIL_MOISTURE_PIN   35
#define DHT_PIN             4
#define DHT_TYPE            DHT22
#define RAIN_SENSOR_PIN     34
// GPIO 0 is the built-in BOOT button on every ESP32 dev board — no extra
// wiring needed. Holding it for RESET_HOLD_MS wipes NVS (all WiFi + URL +
// device/farmer bindings) so the farmer can re-pair from scratch.
#define RESET_BUTTON_PIN    0
// GPIO 2 drives the built-in blue LED on most ESP32 dev boards. If your
// board's LED is on a different pin, change this — only used for the
// visual reset-in-progress feedback.
#define LED_PIN             2
const unsigned long RESET_HOLD_MS = 5000;

// Battery voltage divider on GPIO 33 (ADC1_CH5) — safe with WiFi active.
// Wire: BAT+ → 100 kΩ → GPIO 33 → 100 kΩ → GND. This halves the voltage.
// Set BATTERY_PIN to -1 to disable the read (USB-only builds) and the
// firmware simply omits the battery field from the payload.
#define BATTERY_PIN         33
// LiPo/18650 calibration (3.7 V nominal). At 4.20 V = 100 %, 3.30 V = 0 %.
const float BATT_FULL_V   = 4.20f;
const float BATT_EMPTY_V  = 3.30f;
// 3.3 V ADC ref, 12-bit, ×2 for the divider. Tweak if your resistors differ.
const float BATT_DIVIDER_RATIO = 2.0f;
const float BATT_ADC_REF_V     = 3.30f;
const int   BATT_ADC_MAX       = 4095;

// ─── BLE UUIDs (must match React Native ble-plx constants) ────────────
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ─── Cadences ──────────────────────────────────────────────────────────
const unsigned long BLE_NOTIFY_INTERVAL   = 5000;         // 5 s live
const unsigned long WIFI_POST_INTERVAL    = 60UL * 1000;  // 1 min while testing — bump to 5*60000 for prod
const unsigned long WIFI_RETRY_INTERVAL   = 60UL * 1000;  // 1 min reconnect
const unsigned long WIFI_CONNECT_TIMEOUT  = 15000;        // 15 s per attempt

// ─── Types (must be declared BEFORE any function signature uses them,
//     otherwise Arduino's auto-generated forward prototypes at the top
//     of the sketch reference an unknown type and compilation fails.)
struct Reading {
  float t; float h; int soil; bool rain; bool valid;
  // Battery — -1 means "not read this cycle" (BATTERY_PIN disabled or ADC failed).
  float battV;  int battPct;
};

// ─── Globals ───────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
BLECharacteristic* pCharacteristic = nullptr;
BLEServer*         pServer          = nullptr;
Preferences        prefs;

bool   bleClientConnected = false;
String cfgUrl, cfgDeviceId, cfgFarmerId;
// Per-device auth secret issued by the backend on first pair and relayed
// to the ESP32 via the BLE "tok" field. Included in every /reading POST so
// the backend can reject impostors using a stolen device_id. Empty until
// the pairing flow lands one — during that grace period the backend still
// accepts our posts (grandfathered no-token mode).
String cfgDeviceToken;

// Up to MAX_NETS saved WiFi networks. cfgSsids[0] is the highest priority —
// tried first on boot, then cfgSsids[1], then cfgSsids[2]. Slots with an
// empty ssid are skipped. Layout in NVS: ssid0/pass0, ssid1/pass1, ssid2/pass2.
// This lets a farmer have "home router → phone hotspot → neighbour's WiFi"
// and the ESP32 automatically falls back on router outages.
static const int MAX_NETS = 3;
String cfgSsids[MAX_NETS];
String cfgPasses[MAX_NETS];
// Which slot is currently connected (or -1 if none). Used only for logging.
int    activeNetSlot = -1;

unsigned long lastBleNotify = 0;
unsigned long lastWifiPost  = 0;
unsigned long lastWifiTry   = 0;

// ─── NVS helpers ───────────────────────────────────────────────────────
void loadConfig() {
  prefs.begin("kshakti", true);   // read-only
  cfgUrl         = prefs.getString("url",      "");
  cfgDeviceId    = prefs.getString("dev",      "");
  cfgFarmerId    = prefs.getString("fid",      "");
  cfgDeviceToken = prefs.getString("tok",      "");

  // Load the 3 network slots. Slot 0 is the highest priority.
  for (int i = 0; i < MAX_NETS; i++) {
    String sk = String("ssid") + i;
    String pk = String("pass") + i;
    cfgSsids[i]  = prefs.getString(sk.c_str(), "");
    cfgPasses[i] = prefs.getString(pk.c_str(), "");
  }
  // Peek at the legacy single-slot keys so we can migrate below if needed.
  String legacySsid, legacyPass;
  if (cfgSsids[0].length() == 0) {
    legacySsid = prefs.getString("ssid", "");
    legacyPass = prefs.getString("pass", "");
  }
  prefs.end();

  // Legacy migration: promote old {ssid, pass} keys into slot 0 so a farmer
  // upgrading their firmware doesn't lose their WiFi and have to re-pair.
  if (cfgSsids[0].length() == 0 && legacySsid.length() > 0) {
    cfgSsids[0]  = legacySsid;
    cfgPasses[0] = legacyPass;
    prefs.begin("kshakti", false);
    prefs.putString("ssid0", cfgSsids[0]);
    prefs.putString("pass0", cfgPasses[0]);
    prefs.end();
    Serial.println("[NVS] Migrated legacy ssid/pass → slot 0");
  }

  // Auto-assign a stable device_id on very first boot if the app didn't set one.
  // Uses the ESP32's MAC — printed on the sticker so the farmer can read it.
  if (cfgDeviceId.length() == 0) {
    uint64_t chipId = ESP.getEfuseMac();
    char buf[16];
    snprintf(buf, sizeof(buf), "KS-%04X%08X",
             (uint16_t)(chipId >> 32), (uint32_t)chipId);
    cfgDeviceId = String(buf);
    prefs.begin("kshakti", false);
    prefs.putString("dev", cfgDeviceId);
    prefs.end();
    Serial.printf("[NVS] Assigned device_id: %s\n", cfgDeviceId.c_str());
  }
}

// Wipe every field from NVS and reboot into pristine BLE-pair mode.
// Used by the physical reset button. The reboot is essential — Arduino WiFi
// and BLE stacks hold cached credentials in RAM that a mid-run "cleared"
// NVS would not undo.
void factoryReset() {
  Serial.println("[RESET] Wiping NVS and rebooting into BLE-pair mode...");
  prefs.begin("kshakti", false);
  prefs.clear();
  prefs.end();
  delay(200);
  ESP.restart();
}

// Poll the reset button. If the farmer holds it for RESET_HOLD_MS, we blink
// fast for a second (visual "yes I got you") then factoryReset(). Uses
// INPUT_PULLUP so a press pulls the pin LOW.
//
// This is called from loop() every tick — no blocking, no debounce library
// needed since we only act on a sustained LOW.
unsigned long resetPressStart = 0;
bool resetTriggered = false;
void checkResetButton() {
  bool pressed = (digitalRead(RESET_BUTTON_PIN) == LOW);
  if (pressed) {
    if (resetPressStart == 0) resetPressStart = millis();
    unsigned long held = millis() - resetPressStart;
    // Half-second in, start blinking the LED to give visible feedback.
    if (held > 500) {
      digitalWrite(LED_PIN, (held / 100) % 2 ? HIGH : LOW);
    }
    if (held >= RESET_HOLD_MS && !resetTriggered) {
      resetTriggered = true;
      // Fast confirmation blink so the farmer knows we're wiping.
      for (int i = 0; i < 10; i++) {
        digitalWrite(LED_PIN, HIGH); delay(60);
        digitalWrite(LED_PIN, LOW);  delay(60);
      }
      factoryReset();     // never returns — ESP.restart()
    }
  } else {
    if (resetPressStart != 0) {
      // Released before the threshold — cancel and restore LED.
      digitalWrite(LED_PIN, LOW);
    }
    resetPressStart = 0;
    resetTriggered = false;
  }
}

void mergeAndSaveConfig(const StaticJsonDocument<512>& doc) {
  prefs.begin("kshakti", false);

  // Non-WiFi fields (backend url + device/farmer bindings).
  if (doc.containsKey("url"))  { cfgUrl         = doc["url"].as<String>(); prefs.putString("url", cfgUrl);         }
  if (doc.containsKey("dev"))  { cfgDeviceId    = doc["dev"].as<String>(); prefs.putString("dev", cfgDeviceId);    }
  if (doc.containsKey("fid"))  { cfgFarmerId    = doc["fid"].as<String>(); prefs.putString("fid", cfgFarmerId);    }
  if (doc.containsKey("tok"))  { cfgDeviceToken = doc["tok"].as<String>(); prefs.putString("tok", cfgDeviceToken); }

  // WiFi — three accepted forms, in priority:
  //   (1) `networks: [{ssid,pass}, ...]` — full list replace (up to MAX_NETS).
  //   (2) `slot: N, ssid, pass`          — update just slot N (0..MAX_NETS-1).
  //   (3) `ssid, pass`                    — legacy shortcut, writes slot 0.
  // Older ArduinoJson v6 doesn't support .is<JsonArrayConst>(), so we
  // convert first and then null-check the resulting reference — it's
  // truthy only when the underlying variant is really an array.
  JsonArrayConst netsArr = doc["networks"].as<JsonArrayConst>();
  if (doc.containsKey("networks") && !netsArr.isNull()) {
    for (int i = 0; i < MAX_NETS; i++) {
      String s = (i < (int)netsArr.size()) ? netsArr[i]["ssid"].as<String>() : String("");
      String p = (i < (int)netsArr.size()) ? netsArr[i]["pass"].as<String>() : String("");
      // Keep-existing-password heuristic: the app never learns the actual
      // password (it's masked over BLE for security), so when the farmer
      // edits a slot without retyping the password, the app sends pass="".
      // If the incoming SSID matches what's already saved in this slot AND
      // the incoming pass is empty, preserve the on-device password rather
      // than blowing it away.
      if (s.length() > 0 && p.length() == 0 && s == cfgSsids[i] && cfgPasses[i].length() > 0) {
        p = cfgPasses[i];
      }
      cfgSsids[i]  = s;
      cfgPasses[i] = p;
      prefs.putString((String("ssid") + i).c_str(), s);
      prefs.putString((String("pass") + i).c_str(), p);
    }
  } else if (doc.containsKey("slot")) {
    int slot = doc["slot"].as<int>();
    if (slot >= 0 && slot < MAX_NETS) {
      if (doc.containsKey("ssid")) { cfgSsids[slot]  = doc["ssid"].as<String>(); prefs.putString((String("ssid")+slot).c_str(), cfgSsids[slot]); }
      if (doc.containsKey("pass")) { cfgPasses[slot] = doc["pass"].as<String>(); prefs.putString((String("pass")+slot).c_str(), cfgPasses[slot]); }
    }
  } else if (doc.containsKey("ssid")) {
    cfgSsids[0]  = doc["ssid"].as<String>();
    prefs.putString("ssid0", cfgSsids[0]);
    if (doc.containsKey("pass")) {
      cfgPasses[0] = doc["pass"].as<String>();
      prefs.putString("pass0", cfgPasses[0]);
    }
  }
  prefs.end();

  Serial.printf("[NVS] Config updated  url=%s  dev=%s  fid_len=%d\n",
                cfgUrl.c_str(), cfgDeviceId.c_str(), cfgFarmerId.length());
  for (int i = 0; i < MAX_NETS; i++) {
    if (cfgSsids[i].length() > 0) {
      Serial.printf("[NVS]   slot %d: %s\n", i, cfgSsids[i].c_str());
    }
  }
}

// Publish a JSON snapshot of the currently-saved config into the BLE
// characteristic so the phone app can read it right after connecting.
// Passwords are masked (only the fact that they exist is exposed) so a
// snooping BLE client cannot lift the farmer's WiFi password. The app
// uses this to prefill the Setup/Change WiFi modal.
void publishSavedConfigForRead() {
  if (!pCharacteristic) return;
  StaticJsonDocument<384> doc;
  doc["kind"] = "saved-config";
  doc["dev"]  = cfgDeviceId;
  doc["url"]  = cfgUrl;
  JsonArray arr = doc.createNestedArray("networks");
  for (int i = 0; i < MAX_NETS; i++) {
    if (cfgSsids[i].length() == 0) continue;
    JsonObject o = arr.createNestedObject();
    o["ssid"] = cfgSsids[i];
    o["has_pass"] = cfgPasses[i].length() > 0;
  }
  char buf[384];
  serializeJson(doc, buf);
  pCharacteristic->setValue(buf);
}

// ─── BLE callbacks ─────────────────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleClientConnected = true;
    // Push the saved-config snapshot so the app can read it immediately.
    publishSavedConfigForRead();
    Serial.println("[BLE] Client connected; published saved-config for read.");
  }
  void onDisconnect(BLEServer* pServer) override {
    bleClientConnected = false;
    Serial.println("[BLE] Client disconnected. Re-advertising...");
    pServer->startAdvertising();
  }
};

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    String value = pChar->getValue().c_str();
    if (value.length() == 0) return;

    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, value);
    if (err) {
      Serial.printf("[BLE] JSON parse err: %s\n", err.c_str());
      return;
    }
    mergeAndSaveConfig(doc);

    // If any WiFi slot is populated and we're not currently connected,
    // kick a fresh attempt right away rather than waiting the retry window.
    bool anySsid = false;
    for (int i = 0; i < MAX_NETS; i++) if (cfgSsids[i].length() > 0) { anySsid = true; break; }
    if (WiFi.status() != WL_CONNECTED && anySsid) {
      Serial.println("[BLE] New WiFi creds — attempting connect...");
      WiFi.disconnect(true, false);
      lastWifiTry = 0;   // force immediate retry in loop()
    }
  }
};

// ─── Sensor read ────────────────────────────────────────────────────────
int readSoilMoisture() {
  int raw = analogRead(SOIL_MOISTURE_PIN);
  // Capacitive Soil Moisture Sensor v1.2 calibration:
  //   Dry in air  ≈ 2660
  //   Wet (water) ≈ 1200
  int mapped = map(raw, 2660, 1200, 0, 100);
  return constrain(mapped, 0, 100);
}

bool isRaining() {
  // LM393 rain sensor. Threshold <3000 = actual droplets on the strip;
  // higher values are just humid air. App additionally debounces this.
  return analogRead(RAIN_SENSOR_PIN) < 3000;
}

// Read the battery voltage divider. Returns raw volts and a 0-100 %.
// If BATTERY_PIN is -1 or the ADC returns something implausible, both
// come back as -1 so the payload omits the battery field entirely.
void readBattery(float &volts, int &pct) {
  volts = -1; pct = -1;
  if (BATTERY_PIN < 0) return;
  // Average a few samples to smooth ADC noise.
  long acc = 0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) { acc += analogRead(BATTERY_PIN); delay(2); }
  int raw = acc / samples;
  if (raw < 100) return;   // pin floating / no divider wired
  float measured = (raw * BATT_ADC_REF_V) / BATT_ADC_MAX;
  volts = measured * BATT_DIVIDER_RATIO;
  float span = BATT_FULL_V - BATT_EMPTY_V;
  int p = (int)round(((volts - BATT_EMPTY_V) / span) * 100.0f);
  if (p < 0)   p = 0;
  if (p > 100) p = 100;
  pct = p;
}

Reading readAll() {
  Reading r;
  r.t     = dht.readTemperature();
  r.h     = dht.readHumidity();
  r.soil  = readSoilMoisture();
  r.rain  = isRaining();
  r.valid = !isnan(r.t) && !isnan(r.h);
  readBattery(r.battV, r.battPct);
  return r;
}

// ─── WiFi connect ───────────────────────────────────────────────────────
// Walks the saved slots in priority order (0 → 1 → 2) with a per-slot
// timeout. Falls through if a slot is empty or its attempt fails.
// Sets activeNetSlot to the slot that connected, or -1 if all failed.
void tryConnectWifi() {
  // Fast exits.
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiTry < WIFI_RETRY_INTERVAL && lastWifiTry != 0) return;
  bool anySsid = false;
  for (int i = 0; i < MAX_NETS; i++) if (cfgSsids[i].length() > 0) { anySsid = true; break; }
  if (!anySsid) return;
  lastWifiTry = millis();

  WiFi.mode(WIFI_STA);
  for (int i = 0; i < MAX_NETS; i++) {
    if (cfgSsids[i].length() == 0) continue;
    Serial.printf("[WiFi] Trying slot %d: %s ...\n", i, cfgSsids[i].c_str());
    WiFi.disconnect(false, false);
    WiFi.begin(cfgSsids[i].c_str(), cfgPasses[i].c_str());

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT) {
      delay(500);
      Serial.print(".");
      // Reset button remains responsive even during connect wait —
      // farmer can wipe a stuck config without a power cycle.
      checkResetButton();
    }
    if (WiFi.status() == WL_CONNECTED) {
      activeNetSlot = i;
      Serial.printf("\n[WiFi] Connected to slot %d (%s). IP=%s  RSSI=%d dBm\n",
                    i, cfgSsids[i].c_str(),
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
      return;
    }
    Serial.printf("\n[WiFi] Slot %d failed.\n", i);
  }
  activeNetSlot = -1;
  Serial.println("[WiFi] All slots failed — will retry in 60s.");
}

// ─── Backend POST ───────────────────────────────────────────────────────
void postReading(const Reading& r) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("[HTTP] skip: wifi not connected");         return; }
  if (cfgUrl.length() == 0)          { Serial.println("[HTTP] skip: backend url not set (open Upaj, pair BLE, then tap Setup WiFi at least once)"); return; }
  if (!r.valid)                      { Serial.println("[HTTP] skip: last DHT read invalid");      return; }

  String endpoint = cfgUrl;
  if (!endpoint.endsWith("/")) endpoint += "/";
  endpoint += "api/v1/sensor/reading";

  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(endpoint)) {
    Serial.println("[HTTP] begin() failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<384> body;
  body["device_id"]     = cfgDeviceId;
  // Present the per-device token so the backend can authenticate this
  // POST. Empty until pairing has landed one — the backend grandfathers
  // no-token posts for devices whose row still has NULL device_token.
  if (cfgDeviceToken.length() > 0) body["device_token"] = cfgDeviceToken;
  if (cfgFarmerId.length() > 0)    body["farmer_id"]    = cfgFarmerId;
  body["soil_moisture"] = r.soil;
  body["temperature"]   = round(r.t * 10) / 10.0;
  body["humidity"]      = round(r.h * 10) / 10.0;
  body["is_raining"]    = r.rain;
  // Battery — sent only when a divider is wired. Server tolerates absence.
  if (r.battPct >= 0) {
    body["battery_v"]   = round(r.battV * 100) / 100.0;
    body["battery_pct"] = r.battPct;
  }

  char buf[256];
  serializeJson(body, buf);
  int code = http.POST((uint8_t*)buf, strlen(buf));

  if (code > 0) {
    Serial.printf("[HTTP] POST /reading → %d\n", code);
    if (code >= 400) {
      String resp = http.getString();
      Serial.printf("[HTTP] err body: %s\n", resp.c_str());
    }
  } else {
    Serial.printf("[HTTP] POST failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// ─── BLE notify ─────────────────────────────────────────────────────────
void bleNotify(const Reading& r) {
  if (!bleClientConnected || !r.valid) return;
  StaticJsonDocument<192> doc;
  doc["soil_moisture"] = r.soil;
  doc["temperature"]   = (int)round(r.t);
  doc["humidity"]      = (int)round(r.h);
  doc["is_raining"]    = r.rain;
  if (r.battPct >= 0) doc["battery_pct"] = r.battPct;
  char buf[160];
  serializeJson(doc, buf);
  pCharacteristic->setValue(buf);
  pCharacteristic->notify();
}

// ─── Setup ──────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[BOOT] KisanShakti sensor v2 starting...");

  dht.begin();
  analogReadResolution(12);

  // Physical reset button (uses built-in BOOT button on GPIO 0)
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
  // Status LED (built-in blue on most dev boards)
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  loadConfig();
  Serial.printf("[BOOT] device_id=%s  url=%s  fid_set=%s\n",
                cfgDeviceId.c_str(), cfgUrl.c_str(),
                cfgFarmerId.length() > 0 ? "yes" : "no");
  for (int i = 0; i < MAX_NETS; i++) {
    if (cfgSsids[i].length() > 0) {
      Serial.printf("[BOOT]   WiFi slot %d: %s\n", i, cfgSsids[i].c_str());
    }
  }

  // BLE init — always on, so the farmer can pair or re-pair any time.
  BLEDevice::init("KisanShakti-ESP32");
  BLEDevice::setMTU(247);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ   |
    BLECharacteristic::PROPERTY_WRITE  |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharCallbacks());
  pService->start();

  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] Advertising as KisanShakti-ESP32");

  // Kick a WiFi attempt immediately if any slot has creds.
  bool anySsid = false;
  for (int i = 0; i < MAX_NETS; i++) if (cfgSsids[i].length() > 0) { anySsid = true; break; }
  if (anySsid) {
    lastWifiTry = 0;
    tryConnectWifi();
  } else {
    Serial.println("[WiFi] No creds yet — waiting for pairing via BLE.");
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────────
void loop() {
  // 0. Reset button — checked first every tick so a farmer holding it while
  //    the sensor is mid-WiFi-attempt still gets a responsive wipe.
  checkResetButton();

  // 1. WiFi housekeeping — retry every WIFI_RETRY_INTERVAL if disconnected.
  //    tryConnectWifi() itself checks whether any slot is populated.
  if (WiFi.status() != WL_CONNECTED) {
    tryConnectWifi();
  }

  // 2. Take one reading per BLE tick — used for both BLE notify and (maybe)
  //    the next backend POST. Keeps DHT22 read frequency reasonable.
  static Reading latest;
  if (millis() - lastBleNotify >= BLE_NOTIFY_INTERVAL) {
    lastBleNotify = millis();
    latest = readAll();

    int rawSoil = analogRead(SOIL_MOISTURE_PIN);
    int rawRain = analogRead(RAIN_SENSOR_PIN);
    Serial.printf("[DEBUG] raw soil=%d  raw rain=%d  wifi=%s  slot=%d\n",
                  rawSoil, rawRain,
                  WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "off",
                  activeNetSlot);

    if (!latest.valid) {
      Serial.println("[DHT22] read error — check wiring.");
    } else {
      bleNotify(latest);
    }
  }

  // 3. Push to backend every WIFI_POST_INTERVAL (5 min by default).
  if (WiFi.status() == WL_CONNECTED &&
      latest.valid &&
      (lastWifiPost == 0 || millis() - lastWifiPost >= WIFI_POST_INTERVAL)) {
    lastWifiPost = millis();
    postReading(latest);
  }

  delay(50);
}
