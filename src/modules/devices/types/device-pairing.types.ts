import { DevicePairingHistoryEntity } from '../interfaces/device-pairing-history-entity.interface';

export type DevicePairing = Pick<
  DevicePairingHistoryEntity,
  'deviceId' | 'driverId' | 'pairedBy'
>;
