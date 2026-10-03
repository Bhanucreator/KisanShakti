# KisanShakti Hardware

Field-side devices that plug into the KisanShakti backend. Currently one
device family:

- **`esp32_sensor_node/`** — ESP32-WROOM-32 soil + weather sensor node.
  Ships live readings to the farmer over BLE when nearby, and to the
  backend over WiFi every 5 minutes when at range.

See [`esp32_sensor_node/README.md`](esp32_sensor_node/README.md) for the
full wiring diagram, flashing instructions, and pairing flow.
