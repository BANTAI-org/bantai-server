/**
 * Input shape for creating a device pairing.
 *
 * Deliberately NOT derived from DevicePairingHistoryEntity — that is the
 * READ model (it has id, pairedAt, etc. that a caller never sends). This is
 * the WRITE model: the caller provides exactly one of deviceId (UUID) or
 * hardwareSerial (QR sticker), plus the driver.
 *
 * Repository precedence if both are sent: deviceId wins.
 */
export interface DevicePairing {
  deviceId?: string;
  hardwareSerial?: string;
  driverId: string;
  pairedBy?: string;
}
