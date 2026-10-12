import { DatabaseService } from '../../database/database.service';
import { DeviceStatus } from './enums/device-status.enum';
import { CreateNewDeviceData } from './types/create-new-device.type';

interface RegisteredDeviceRow {
  id: string;
  hardware_serial: string;
  status: DeviceStatus;
  registered_at: Date;
}

interface PairedDeviceRow {
  id: string;
  hardware_serial: string;
  status: DeviceStatus;
  driver_id: string;
  paired_at: Date;
}

export class DevicesRepository {
  constructor(private readonly db: DatabaseService) {}

  async registerNewDevice(data: CreateNewDeviceData) {
    const { hardwareSerial, registeredBy } = data;

    const sql = `
      INSERT INTO device (hardware_serial, status, registered_by, registered_at) 
      VALUES ($1, $2, $3, NOW()) 
      RETURNING id, hardware_serial, status, registered_at
    `;
    const result = await this.db.query<RegisteredDeviceRow>(sql, [
      hardwareSerial,
      DeviceStatus.INVENTORY,
      registeredBy ?? null,
    ]);

    return result.rows[0];
  }

  async pairDevice(data: {
    deviceId: string;
    driverId: string;
    pairedBy?: string;
  }) {
    const { deviceId, driverId, pairedBy } = data;

    return this.db.withTransaction(async (client) => {
      const updateDeviceSql = `
        UPDATE device
        SET status = $1,
            driver_id = $2,
            paired_at = NOW(),
            unpaired_at = NULL
        WHERE id = $3 AND status = 'inventory'
        RETURNING id, hardware_serial, status, driver_id, paired_at
      `;
      const deviceResult = await client.query<PairedDeviceRow>(
        updateDeviceSql,
        [DeviceStatus.PAIRED, driverId, deviceId],
      );

      const device = deviceResult.rows[0];
      if (!device) {
        throw new Error(
          'Device not found or is not currently in inventory status.',
        );
      }

      // 2. Write immutable audit record to device_pairing_history[cite: 1]
      const insertHistorySql = `
        INSERT INTO device_pairing_history (device_id, driver_id, paired_by, paired_at)
        VALUES ($1, $2, $3, $4)
      `;
      await client.query(insertHistorySql, [
        deviceId,
        driverId,
        pairedBy ?? null,
        device.paired_at,
      ]);

      return device;
    });
  }
}
