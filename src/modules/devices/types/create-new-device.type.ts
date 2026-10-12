import { DeviceEntity } from '../interfaces/device-entity.interface';

export type CreateNewDeviceData = Pick<
  DeviceEntity,
  'hardwareSerial' | 'registeredBy'
>;
