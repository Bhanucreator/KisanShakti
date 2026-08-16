/**
 * Stub for react-native-ble-plx in Expo Go.
 * BLE requires native code — this stub lets the weather/BLE screen
 * render without crashing. Scanning simply does nothing.
 */

export class BleManager {
  startDeviceScan(
    _uuids: string[] | null,
    _options: unknown,
    _callback: unknown,
  ) {}
  stopDeviceScan() {}
  connectToDevice(_id: string): Promise<Device> {
    return Promise.reject(new Error('BLE not available in Expo Go'));
  }
  destroy() {}
}

export type Device = {
  id: string;
  name: string | null;
  discoverAllServicesAndCharacteristics: () => Promise<Device>;
  writeCharacteristicWithResponseForService: (
    serviceUUID: string,
    characteristicUUID: string,
    value: string,
  ) => Promise<void>;
  monitorCharacteristicForService: (
    serviceUUID: string,
    characteristicUUID: string,
    callback: (error: Error | null, characteristic: { value: string } | null) => void,
  ) => { remove: () => void };
};
