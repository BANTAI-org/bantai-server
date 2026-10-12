export interface DevicePairingHistoryEntity {
  id: string; // UUID
  deviceId: string; // UUID
  driverId: string; // UUID
  pairedBy: string | null; // UUID
  pairedAt: string; // ISO 8601 Date/Time string (TIMESTAMPTZ)
  unpairedAt: string | null; // ISO 8601 Date/Time string
  unpairReason: string | null;
}
