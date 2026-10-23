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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('devices')
@UseGuards(JwtGuard, RolesGuard)
@ApiTags('Devices')
@ApiBearerAuth('access-token')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a device' })
  @ApiBody({ type: CreateDeviceDto })
  @ApiResponse({ status: 201, description: 'Device registered' })
  @ApiResponse({ status: 400, description: 'Invalid device data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  async registerDevice(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.registerDevice({
      hardwareSerial: createDeviceDto.hardwareSerial,
      registeredBy: createDeviceDto.registeredBy ?? null,
    });
  }

  @Post('pair')
  @ApiOperation({ summary: 'Pair a device with a driver' })
  @ApiBody({ type: PairDeviceDto })
  @ApiResponse({ status: 201, description: 'Device paired' })
  @ApiResponse({ status: 400, description: 'Invalid pairing data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.RESPONDER, Role.DRIVER)
  async pairDevice(@Body() pairDeviceDto: PairDeviceDto) {
    return this.devicesService.pairDevice({
      deviceId: pairDeviceDto.deviceId,
      driverId: pairDeviceDto.driverId,
    });
  }

  @Post(':deviceId/unpair')
  @ApiOperation({ summary: 'Unpair a device' })
  @ApiParam({ name: 'deviceId', description: 'Device UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        unpairedBy: {
          type: 'string',
          format: 'uuid',
          description: 'UUID of the user recording the unpair action',
          example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Device unpaired' })
  @ApiResponse({ status: 400, description: 'Invalid device ID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
  @ApiOperation({ summary: 'Report a device as lost' })
  @ApiParam({ name: 'deviceId', description: 'Device UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        reportedBy: {
          type: 'string',
          format: 'uuid',
          description: 'UUID of the user reporting the device as lost',
          example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Device reported lost' })
  @ApiResponse({ status: 400, description: 'Invalid device ID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
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
  @ApiOperation({ summary: 'Decommission a device' })
  @ApiParam({ name: 'deviceId', description: 'Device UUID' })
  @ApiResponse({ status: 201, description: 'Device decommissioned' })
  @ApiResponse({ status: 400, description: 'Invalid device ID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  async decommissionDevice(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    return this.devicesService.decommissionDevice(deviceId);
  }

  @Get(':deviceId')
  @ApiOperation({ summary: 'Get a device by ID' })
  @ApiParam({ name: 'deviceId', description: 'Device UUID' })
  @ApiResponse({ status: 200, description: 'Device returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Device not found' })
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
  @ApiOperation({ summary: 'List devices by status' })
  @ApiParam({ name: 'status', description: 'Device status' })
  @ApiResponse({ status: 200, description: 'Devices returned' })
  @ApiResponse({ status: 400, description: 'Invalid status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Roles(Role.ADMIN, Role.SUPER)
  async getDevicesByStatus(
    @Param('status', new ParseEnumPipe(DeviceStatus))
    status: DeviceStatus,
  ) {
    return this.devicesService.getDevicesByStatus(status);
  }

  @Get('driver/:driverId')
  @ApiOperation({ summary: 'List devices paired with a driver' })
  @ApiParam({ name: 'driverId', description: 'Driver UUID' })
  @ApiResponse({ status: 200, description: 'Devices returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Driver not found' })
  @Roles(Role.ADMIN, Role.DRIVER)
  async getDevicesByDriver(
    @Param('driverId', ParseUUIDPipe)
    driverId: string,
  ) {
    return this.devicesService.getDevicesByDriver(driverId);
  }

  @Post(':deviceId/heartbeat')
  @ApiOperation({ summary: 'Update a device heartbeat' })
  @ApiParam({ name: 'deviceId', description: 'Device UUID' })
  @ApiResponse({ status: 201, description: 'Heartbeat updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  @Roles(Role.DRIVER)
  async updateDeviceHeartbeat(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    return this.devicesService.updateHeartbeat(deviceId);
  }

  @Get(':deviceId/history')
  @ApiOperation({ summary: 'Get device pairing history' })
  @ApiParam({ name: 'deviceId', description: 'Device UUID' })
  @ApiResponse({ status: 200, description: 'Pairing history returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  @Roles(Role.ADMIN, Role.SUPER)
  async getDevicePairingHistory(
    @Param('deviceId', ParseUUIDPipe)
    deviceId: string,
  ) {
    return this.devicesService.getDevicePairingHistory(deviceId);
  }
}
