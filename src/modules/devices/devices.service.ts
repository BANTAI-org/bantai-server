import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';

import { DevicesRepository } from './devices.repository';
import { CreateNewDeviceData } from './types/create-new-device.type';
import { DeviceEntity } from './interfaces/device-entity.interface';
import { DeviceStatus } from './enums/device-status.enum';

@Injectable()
export class DevicesService {
  constructor(private readonly devicesRepository: DevicesRepository) {}

  async registerDevice(data: CreateNewDeviceData): Promise<DeviceEntity> {
    return this.devicesRepository.registerNewDevice(data);
  }

  async pairDevice(data: {
    deviceId?: string;
    hardwareSerial?: string;
    driverId: string;
    pairedBy?: string;
  }): Promise<DeviceEntity> {
    return this.devicesRepository.pairDevice(data);
  }

  async unpairDevice(
    deviceId: string,
    unpairedBy?: string,
  ): Promise<DeviceEntity> {
    const device = await this.devicesRepository.getDeviceById(deviceId);

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    if (device.status !== DeviceStatus.PAIRED) {
      throw new BadRequestException(
        `Device is not currently paired (current status: ${device.status})`,
      );
    }

    const updatedDevice = await this.devicesRepository.updateDevice(deviceId, {
      status: DeviceStatus.INVENTORY,
      driverId: null,
      pairedAt: null,
      unpairedAt: new Date().toISOString(),
    });

    void unpairedBy;
    await this.devicesRepository.addDevicePairingHistory(
      deviceId,
      device.driverId,
      unpairedBy ?? null,
      new Date(device.pairedAt ?? new Date().toISOString()),
      new Date(),
      'manual_unpair',
    );

    return updatedDevice;
  }

  async reportLost(
    deviceId: string,
    reportedBy?: string,
  ): Promise<DeviceEntity> {
    const device = await this.devicesRepository.getDeviceById(deviceId);

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    if (
      device.status === DeviceStatus.REPORTED_LOST ||
      device.status === DeviceStatus.DECOMMISSIONED
    ) {
      throw new BadRequestException(
        `Device cannot be reported lost (current status: ${device.status})`,
      );
    }

    void reportedBy;

    const updatedDevice = await this.devicesRepository.updateDevice(deviceId, {
      status: DeviceStatus.REPORTED_LOST,
    });

    return updatedDevice;
  }

  async decommissionDevice(deviceId: string): Promise<DeviceEntity> {
    const device = await this.devicesRepository.getDeviceById(deviceId);

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    if (device.status === DeviceStatus.DECOMMISSIONED) {
      throw new BadRequestException('Device is already decommissioned');
    }

    const currentDriverId = device.driverId;
    const currentPairedAt = device.pairedAt;

    const updatedDevice = await this.devicesRepository.updateDevice(deviceId, {
      status: DeviceStatus.DECOMMISSIONED,
      driverId: null,
      pairedAt: null,
      unpairedAt: new Date().toISOString(),
    });

    if (currentDriverId && currentPairedAt) {
      await this.devicesRepository.addDevicePairingHistory(
        deviceId,
        currentDriverId,
        null,
        new Date(currentPairedAt ?? new Date().toISOString()),
        new Date(),
        'decommissioned',
      );
    }

    return updatedDevice;
  }

  async getDeviceById(deviceId: string): Promise<DeviceEntity | null> {
    return this.devicesRepository.getDeviceById(deviceId);
  }

  async getDevicesByStatus(status: DeviceStatus): Promise<DeviceEntity[]> {
    return this.devicesRepository.getDevicesByStatus(status);
  }

  async getDevicesByDriver(driverId: string): Promise<DeviceEntity[]> {
    return this.devicesRepository.getDevicesByDriver(driverId);
  }

  async updateHeartbeat(deviceId: string): Promise<DeviceEntity> {
    const device = await this.devicesRepository.getDeviceById(deviceId);

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    return this.devicesRepository.updateDevice(deviceId, {
      lastHeartbeatAt: new Date().toISOString(),
    });
  }

  async getDevicePairingHistory(deviceId: string): Promise<any[]> {
    return this.devicesRepository.getDevicePairingHistory(deviceId);
  }
}
