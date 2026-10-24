import { DeviceStatus } from '../enums/device-status.enum';
export interface DriverDeviceView {
  deviceId: string;
  hardwareSerial: string;
  deviceStatus: DeviceStatus;
  pairedAt: string | null;
}
