/*
 * KisanShakti ESP32 Sensor Node Firmware
 * Hardware: ESP32-WROOM-32
 * Sensors:
 *   - Capacitive Soil Moisture Sensor v1.2 → GPIO 34 (ADC)
 *   - DHT22 (Temperature/Humidity)         → GPIO 4
 *   - Rain Drop Sensor                     → GPIO 35 (ADC)
 *
 * Functionality:
 *   1. Broadcasts BLE as "KisanShakti-ESP32"
 *   2. On credential write: connects to Upaj app hotspot
 *   3. Reads sensors every 5 seconds
 *   4. Notifies connected BLE client with JSON sensor payload
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <DHT.h>
#include <WiFi.h>
#include <ArduinoJson.h>

// ─── Pin Definitions ───────────────────────────────────────────────────
#define SOIL_MOISTURE_PIN   35  
#define DHT_PIN             4
#define DHT_TYPE            DHT22
#define RAIN_SENSOR_PIN     34  

// ─── BLE UUIDs (must match React Native ble-plx constants) ────────────
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ─── Globals ───────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
bool credentialsReceived = false;
String hotspotSSID = "";
String hotspotPass = "";

// ─── BLE Server Callbacks ──────────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    Serial.println("[BLE] Device connected.");
  }
  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    credentialsReceived = false;
    Serial.println("[BLE] Device disconnected. Restarting advertising...");
    pServer->startAdvertising();
  }
};

// ─── Characteristic Write Callback (receives hotspot creds) ───────────
class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    String value = pChar->getValue().c_str();
    if (value.length() > 0) {
      // Decode base64 JSON: {"ssid":"...","pass":"..."}
      StaticJsonDocument<256> doc;
      DeserializationError err = deserializeJson(doc, value);
      if (!err) {
        hotspotSSID = doc["ssid"].as<String>();
        hotspotPass = doc["pass"].as<String>();
        credentialsReceived = true;
        Serial.printf("[BLE] Credentials received — SSID: %s\n", hotspotSSID.c_str());
      }
    }
  }
};

// ─── Sensor Read ────────────────────────────────────────────────────────
int readSoilMoisture() {
  int raw = analogRead(SOIL_MOISTURE_PIN);
  // Calibration for Capacitive Soil Moisture Sensor v1.2:
  // Dry in air is ~2660. Wet (underwater) is ~1200.
  int mapped = map(raw, 2660, 1200, 0, 100);
  return constrain(mapped, 0, 100);
}

bool isRaining() {
  // Calibration for standard Rain Drop Sensor:
  // Dry is 4095. A few droplets will drop it below 3500.
  return analogRead(RAIN_SENSOR_PIN) < 3500;
}

// ─── Setup ──────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  dht.begin();
  analogReadResolution(12);

  // BLE init
  BLEDevice::init("KisanShakti-ESP32");
  BLEServer* pServer = BLEDevice::createServer();
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
}

// ─── Main Loop ──────────────────────────────────────────────────────────
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 5000; // ms

void loop() {
  // Connect to hotspot once credentials arrive
  if (credentialsReceived && WiFi.status() != WL_CONNECTED) {
    Serial.printf("[WiFi] Connecting to %s ...\n", hotspotSSID.c_str());
    WiFi.begin(hotspotSSID.c_str(), hotspotPass.c_str());
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 10000) {
      delay(500);
      Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    }
  }

  // Notify BLE client with sensor data every 5 seconds
  if (deviceConnected && millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();

    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();
    int   soilMoist   = readSoilMoisture();
    bool  rain        = isRaining();
    
    int rawSoil = analogRead(SOIL_MOISTURE_PIN);
    int rawRain = analogRead(RAIN_SENSOR_PIN);

    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("[DHT22] Read error. Check DHT wiring!");
      return;
    }

    // Print raw debugging data to Serial Monitor
    Serial.printf("[DEBUG] Raw Soil ADC (Pin 34): %d | Raw Rain ADC (Pin 35): %d\n", rawSoil, rawRain);

    // Build JSON payload
    StaticJsonDocument<128> doc;
    doc["soil_moisture"] = soilMoist;
    doc["temperature"]   = (int)round(temperature);
    doc["humidity"]      = (int)round(humidity);
    doc["is_raining"]    = rain;

    char buf[128];
    serializeJson(doc, buf);
    pCharacteristic->setValue(buf);
    pCharacteristic->notify();
    Serial.printf("[SENSOR] Sent: %s\n", buf);
  }
}
