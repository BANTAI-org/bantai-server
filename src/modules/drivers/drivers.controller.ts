import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { AuthTokens } from '../auth/interfaces/auth-token.interface';
import { RefreshCookieService } from '../auth/helpers/refresh-cookie.help';
import { DriverService } from './drivers.service';
import { OtpRequestResult } from './interfaces/otp-result.interface';
import { ResetTokenResult } from './interfaces/result-token-result.interface';
import { CreateDriverDto } from './dto/create-driver.dto';
import { PatchDriverProfileDto } from './dto/patch-driver-profile.dto';
import { PasswordResetIdentityDto } from './dto/password-reset-identity.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/password-reset.dto';
import type { UserIdType } from '../responders/types/user-id.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DriverProfileDataRow } from './types/driver-profile-data-row.type';
import { ChangeDutyDto } from './dto/change-duty-driver.dto';

import { IncidentService } from '../incidents/incidents.service';
import { RedisService } from '../redis/redis.service';
import { haversineDistance } from '../../common/utils/geo.utils';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
@Controller('drivers')
@ApiTags('Drivers')
@ApiBearerAuth('access-token')
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly refreshCookie: RefreshCookieService,
    private readonly incidentService: IncidentService,
    private readonly redisService: RedisService,
  ) {}
  logger = new Logger(DriverController.name);
  private readonly MAX_LOCATION_AGE_MS = 30_000;

  @Post('register')
  @ApiOperation({ summary: 'Register a driver account' })
  @ApiBody({ type: CreateDriverDto })
  @ApiResponse({ status: 201, description: 'Driver account created' })
  @ApiResponse({ status: 400, description: 'Invalid registration data' })
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateDriverDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthTokens & UserIdType> {
    const phoneVerifiedAt = new Date();

    const result = await this.driverService.registerDriver(
      dto,
      phoneVerifiedAt,
    );

    this.refreshCookie.set(response, result.refreshToken);

    return result;
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update the authenticated driver profile' })
  @ApiBody({ type: PatchDriverProfileDto })
  @ApiResponse({ status: 200, description: 'Driver profile updated' })
  @ApiResponse({ status: 400, description: 'Invalid profile data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.DRIVER)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: PatchDriverProfileDto,
    @CurrentUser('sub') userId: string,
  ) {
    const phoneVerifiedAt = dto.m_number ? new Date() : undefined;

    return this.driverService.updateProfile(userId, dto, phoneVerifiedAt);
  }

  @Post('forgot-password/request')
  @ApiOperation({ summary: 'Request a driver password reset OTP' })
  @ApiBody({ type: PasswordResetIdentityDto })
  @ApiResponse({ status: 202, description: 'Password reset request accepted' })
  @ApiResponse({ status: 400, description: 'Invalid identity information' })
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: PasswordResetIdentityDto,
  ): Promise<OtpRequestResult> {
    return this.driverService.requestPasswordResetOtp(dto);
  }

  @Post('forgot-password/verify')
  @ApiOperation({ summary: 'Verify a driver password reset OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, description: 'Reset token issued' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @HttpCode(HttpStatus.OK)
  async verifyPasswordResetOtp(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: VerifyOtpDto,
  ): Promise<ResetTokenResult> {
    return this.driverService.verifyPasswordResetOtp(dto);
  }

  @Post('forgot-password/reset')
  @ApiOperation({ summary: 'Reset a driver password' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 204, description: 'Password reset' })
  @ApiResponse({ status: 400, description: 'Invalid reset token or password' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: ResetPasswordDto,
  ): Promise<void> {
    return this.driverService.resetPassword(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get the authenticated driver profile' })
  @ApiResponse({ status: 200, description: 'Driver profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async getDriverUserProfile(
    @CurrentUser('sub') userId: string,
  ): Promise<DriverProfileDataRow | null> {
    this.logger.debug(`received user id: ${userId}`);
    return this.driverService.getDriverProfile(userId);
  }

  @Patch('duty')
  @ApiOperation({ summary: 'Update the authenticated driver duty status' })
  @ApiBody({ type: ChangeDutyDto })
  @ApiResponse({ status: 200, description: 'Duty status updated' })
  @ApiResponse({ status: 400, description: 'Invalid duty status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async changeDuty(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangeDutyDto,
  ) {
    this.logger.debug(`received user id: ${userId}`);
    return this.driverService.setDutyStatus(userId, dto);
  }

  @Get(':driverId/incidents/:incidentId/responder-distance')
  @ApiOperation({ summary: 'Get responder distance for a driver incident' })
  @ApiParam({ name: 'driverId', description: 'Driver UUID' })
  @ApiParam({ name: 'incidentId', description: 'Incident UUID' })
  @ApiResponse({ status: 200, description: 'Responder distance returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async getResponderDistance(
    @Param('driverId') driverId: string,
    @Param('incidentId') incidentId: string,
    @CurrentUser('sub') authDriverId: string,
  ): Promise<{
    distanceMeters: number;
    calculatedAt: string;
    locationAgeMs: number;
    isStale: boolean;
  }> {
    if (authDriverId !== driverId) {
      throw new ForbiddenException('You can only access your own driver data');
    }

    const incident = await this.incidentService.getIncident(incidentId);
    if (!incident) {
      throw new NotFoundException('Incident not found');
    }

    if (incident.driver_id !== driverId) {
      throw new ForbiddenException('This incident does not belong to you');
    }

    const responderId = incident.claimed_by_id;
    if (!responderId) {
      return {
        distanceMeters: -1,
        calculatedAt: new Date().toISOString(),
        locationAgeMs: 0,
        isStale: false,
      };
    }

    const driverLocation = await this.redisService.getFresh(driverId);
    const responderLocation = await this.redisService.getFresh(responderId);

    const driverLocationAge = driverLocation
      ? Date.now() - driverLocation.updated_at
      : Number.POSITIVE_INFINITY;
    const responderLocationAge = responderLocation
      ? Date.now() - responderLocation.updated_at
      : Number.POSITIVE_INFINITY;
    const locationAgeMs = Math.max(driverLocationAge, responderLocationAge);
    const isStale = locationAgeMs > this.MAX_LOCATION_AGE_MS;

    if (!driverLocation || !responderLocation) {
      return {
        distanceMeters: -1,
        calculatedAt: new Date().toISOString(),
        locationAgeMs,
        isStale,
      };
    }

    const distanceMeters = haversineDistance(driverLocation, responderLocation);

    return {
      distanceMeters,
      calculatedAt: new Date().toISOString(),
      locationAgeMs,
      isStale,
    };
  }
}
