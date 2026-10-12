import { DeviceStatus } from '../enums/device-status.enum';

export interface DeviceEntity {
  id: string; // UUID
  hardwareSerial: string;
  status: DeviceStatus;
  driverId: string | null; // UUID
  registeredBy: string | null; // UUID
  registeredAt: string; // ISO 8601 Date/Time string (TIMESTAMPTZ)
  pairedAt: string | null; // ISO 8601 Date/Time string
  unpairedAt: string | null; // ISO 8601 Date/Time string
  lastHeartbeatAt: string | null; // ISO 8601 Date/Time string
}
