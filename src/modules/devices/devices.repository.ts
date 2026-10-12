import { DatabaseService } from '../../database/database.service';
import { DeviceStatus } from './enums/device-status.enum';
import { CreateNewDeviceData } from './types/create-new-device.type';
import { DeviceEntity } from './interfaces/device-entity.interface';
import { DevicePairingHistoryEntity } from './interfaces/device-pairing-history-entity.interface';

interface DeviceRow {
  id: string;
  hardwareSerial: string;
  status: DeviceStatus;
  driverId: string | null;
  registeredBy: string | null;
  registeredAt: Date | string;
  pairedAt: Date | string | null;
  unpairedAt: Date | string | null;
  lastHeartbeatAt: Date | string | null;
}

const DEVICE_COLUMNS = `
  id,
  hardware_serial AS "hardwareSerial",
  status,
  driver_id AS "driverId",
  registered_by AS "registeredBy",
  registered_at AS "registeredAt",
  paired_at AS "pairedAt",
  unpaired_at AS "unpairedAt",
  last_heartbeat_at AS "lastHeartbeatAt"
`;

function mapDeviceRow(row: DeviceRow): DeviceEntity {
  const toIsoString = (value: Date | string | null): string | null =>
    value === null ? null : value instanceof Date ? value.toISOString() : value;

  return {
    ...row,
    registeredAt: toIsoString(row.registeredAt)!,
    pairedAt: toIsoString(row.pairedAt),
    unpairedAt: toIsoString(row.unpairedAt),
    lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
  };
}

export class DevicesRepository {
  constructor(private readonly db: DatabaseService) {}

  async registerNewDevice(data: CreateNewDeviceData) {
    const { hardwareSerial, registeredBy } = data;

    const sql = `
      INSERT INTO device (hardware_serial, status, registered_by, registered_at) 
      VALUES ($1, $2, $3, NOW()) 
      RETURNING ${DEVICE_COLUMNS}
    `;
    const result = await this.db.query<DeviceRow>(sql, [
      hardwareSerial,
      DeviceStatus.INVENTORY,
      registeredBy ?? null,
    ]);

    return mapDeviceRow(result.rows[0]);
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
        RETURNING ${DEVICE_COLUMNS}
      `;
      const deviceResult = await client.query<DeviceRow>(updateDeviceSql, [
        DeviceStatus.PAIRED,
        driverId,
        deviceId,
      ]);

      const deviceRow = deviceResult.rows[0];
      if (!deviceRow) {
        throw new Error(
          'Device not found or is not currently in inventory status.',
        );
      }
      const device = mapDeviceRow(deviceRow);

      // 2. Write immutable audit record to device_pairing_history[cite: 1]
      const insertHistorySql = `
        INSERT INTO device_pairing_history (device_id, driver_id, paired_by, paired_at)
        VALUES ($1, $2, $3, $4)
      `;
      await client.query(insertHistorySql, [
        deviceId,
        driverId,
        pairedBy ?? null,
        device.pairedAt,
      ]);

      return device;
    });
  }

  async getDeviceById(deviceId: string): Promise<DeviceEntity | null> {
    const sql = `
      SELECT ${DEVICE_COLUMNS}
      FROM device
      WHERE id = $1
    `;

    const result = await this.db.query<DeviceRow>(sql, [deviceId]);
    return result.rows[0] ? mapDeviceRow(result.rows[0]) : null;
  }

  async getDevicesByStatus(status: DeviceStatus): Promise<DeviceEntity[]> {
    const sql = `
      SELECT ${DEVICE_COLUMNS}
      FROM device
      WHERE status = $1
      ORDER BY registered_at DESC
    `;

    const result = await this.db.query<DeviceRow>(sql, [status]);
    return result.rows.map(mapDeviceRow);
  }

  async getDevicesByDriver(driverId: string): Promise<DeviceEntity[]> {
    const sql = `
      SELECT ${DEVICE_COLUMNS}
      FROM device
      WHERE driver_id = $1 AND status = 'paired'
      ORDER BY paired_at DESC
    `;

    const result = await this.db.query<DeviceRow>(sql, [driverId]);
    return result.rows.map(mapDeviceRow);
  }

  async updateDevice(
    deviceId: string,
    updates: {
      status?: DeviceStatus;
      driverId?: string | null;
      registeredBy?: string | null;
      registeredAt?: string;
      pairedAt?: string | null;
      unpairedAt?: string | null;
      lastHeartbeatAt?: string | null;
    },
  ): Promise<DeviceEntity> {
    const fields: string[] = [];
    const values: any[] = [];
    let index = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${index++}`);
      values.push(updates.status);
    }

    if (updates.driverId !== undefined) {
      fields.push(`driver_id = $${index++}`);
      values.push(updates.driverId);
    }

    if (updates.registeredBy !== undefined) {
      fields.push(`registered_by = $${index++}`);
      values.push(updates.registeredBy);
    }

    if (updates.registeredAt !== undefined) {
      fields.push(`registered_at = $${index++}`);
      values.push(updates.registeredAt);
    }

    if (updates.pairedAt !== undefined) {
      fields.push(`paired_at = $${index++}`);
      values.push(updates.pairedAt);
    }

    if (updates.unpairedAt !== undefined) {
      fields.push(`unpaired_at = $${index++}`);
      values.push(updates.unpairedAt);
    }

    if (updates.lastHeartbeatAt !== undefined) {
      fields.push(`last_heartbeat_at = $${index++}`);
      values.push(updates.lastHeartbeatAt);
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(deviceId); // for deviceId in WHERE clause

    const sql = `
      UPDATE device
      SET ${fields.join(', ')}
      WHERE id = $${index}
      RETURNING ${DEVICE_COLUMNS}
    `;

    const result = await this.db.query<DeviceRow>(sql, values);
    const updatedDevice = result.rows[0];
    if (!updatedDevice) {
      throw new Error(`Device with ID ${deviceId} not found`);
    }
    return mapDeviceRow(updatedDevice);
  }

  async addDevicePairingHistory(
    deviceId: string,
    driverId: string | null,
    pairedBy: string | null,
    pairedAt: Date,
    unpairedAt: Date | null = null,
    unpairReason: string | null = null,
  ): Promise<void> {
    const sql = `
      INSERT INTO device_pairing_history (device_id, driver_id, paired_by, paired_at, unpaired_at, unpair_reason)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await this.db.query(sql, [
      deviceId,
      driverId,
      pairedBy,
      pairedAt,
      unpairedAt,
      unpairReason,
    ]);
  }

  async getDevicePairingHistory(
    deviceId: string,
  ): Promise<DevicePairingHistoryEntity[]> {
    const sql = `
      SELECT
        id,
        device_id AS "deviceId",
        driver_id AS "driverId",
        paired_by AS "pairedBy",
        paired_at AS "pairedAt",
        unpaired_at AS "unpairedAt",
        unpair_reason AS "unpairReason"
      FROM device_pairing_history
      WHERE device_id = $1
      ORDER BY paired_at DESC
    `;

    const result = await this.db.query<DevicePairingHistoryEntity>(sql, [
      deviceId,
    ]);
    return result.rows;
  }
}
