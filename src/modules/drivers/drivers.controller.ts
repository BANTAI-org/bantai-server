import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
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

@Controller('drivers')
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}
  logger = new Logger(DriverController.name);

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateDriverDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthTokens & UserIdType> {
    const phoneVerifiedAt = new Date(); // TODO: replace with real OTP verification

    const result = await this.driverService.registerDriver(
      dto,
      phoneVerifiedAt,
    );

    this.refreshCookie.set(response, result.refreshToken);

    return result;
  }

  @Patch('profile')
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
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: PasswordResetIdentityDto,
  ): Promise<OtpRequestResult> {
    return this.driverService.requestPasswordResetOtp(dto);
  }

  @Post('forgot-password/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPasswordResetOtp(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: VerifyOtpDto,
  ): Promise<ResetTokenResult> {
    return this.driverService.verifyPasswordResetOtp(dto);
  }

  @Post('forgot-password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: ResetPasswordDto,
  ): Promise<void> {
    return this.driverService.resetPassword(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async getDriverUserProfile(
    @CurrentUser('sub') userId: string,
  ): Promise<DriverProfileDataRow | null> {
    this.logger.debug(`received user id: ${userId}`);
    return this.driverService.getDriverProfile(userId);
  }
}
