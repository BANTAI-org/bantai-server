import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/devices.dto';
import { PairDeviceDto } from './dto/devices.dto';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { DeviceStatus } from './enums/device-status.enum';

@Controller('devices')
@UseGuards(JwtGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @Roles(Role.ADMIN, Role.SUPER)
  async registerDevice(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.registerDevice({
      hardwareSerial: createDeviceDto.hardwareSerial,
      registeredBy: createDeviceDto.registeredBy ?? null,
    });
  }

  @Post('pair')
  @Roles(Role.ADMIN, Role.RESPONDER)
  async pairDevice(@Body() pairDeviceDto: PairDeviceDto) {
    return this.devicesService.pairDevice({
      deviceId: pairDeviceDto.deviceId,
      driverId: pairDeviceDto.driverId,
    });
  }

  @Post(':deviceId/unpair')
  @Roles(Role.ADMIN, Role.RESPONDER)
  async unpairDevice(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
    @Body('unpairedBy', ParseUUIDPipe)
    unpairedBy?: string,
  ) {
    return this.devicesService.unpairDevice(deviceId, unpairedBy);
  }

  @Post(':deviceId/report-lost')
  @Roles(Role.ADMIN, Role.RESPONDER)
  async reportLostDevice(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
    @Body('reportedBy', ParseUUIDPipe)
    reportedBy?: string,
  ) {
    return this.devicesService.reportLost(deviceId, reportedBy);
  }

  @Post(':deviceId/decommission')
  @Roles(Role.ADMIN, Role.SUPER)
  async decommissionDevice(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    return this.devicesService.decommissionDevice(deviceId);
  }

  @Get(':deviceId')
  @Roles(Role.ADMIN, Role.RESPONDER, Role.DRIVER)
  async getDevice(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    const device = await this.devicesService.getDeviceById(deviceId);
    if (!device) {
      throw new Error(`Device not found`);
    }
    return device;
  }

  @Get('status/:status')
  @Roles(Role.ADMIN, Role.SUPER)
  async getDevicesByStatus(
    @Param('status', new ParseEnumPipe(DeviceStatus))
    status: DeviceStatus,
  ) {
    return this.devicesService.getDevicesByStatus(status);
  }

  @Get('driver/:driverId')
  @Roles(Role.ADMIN, Role.DRIVER)
  async getDevicesByDriver(
    @Param('driverId', ParseUUIDPipe)
    driverId: string,
  ) {
    return this.devicesService.getDevicesByDriver(driverId);
  }

  @Post(':deviceId/heartbeat')
  @Roles(Role.DRIVER)
  async updateDeviceHeartbeat(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    return this.devicesService.updateHeartbeat(deviceId);
  }

  @Get(':deviceId/history')
  @Roles(Role.ADMIN, Role.SUPER)
  async getDevicePairingHistory(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    return this.devicesService.getDevicePairingHistory(deviceId);
  }
}
