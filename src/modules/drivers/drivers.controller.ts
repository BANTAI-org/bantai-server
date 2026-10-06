import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { Role } from '../../common/enums/role-enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthTokens } from '../auth/interfaces/auth-token.interface';
import { RefreshCookieService } from '../auth/helpers/refresh-cookie.help';
import { DriverService } from './drivers.service';
import { OtpRequestResult } from './interfaces/otp-result.interface';
import { CreateDriverDto } from './dto/create-driver.dto';
import { PatchDriverProfileDto } from './dto/patch-driver-profile.dto';
import { PasswordResetIdentityDto } from './dto/password-reset-identity.dto';
import { ResetPasswordDto } from './dto/password-reset.dto';
import { UserIdType } from '../responders/types/user-id.types';

type AuthenticatedRequest = FastifyRequest & { user: JwtPayload };

@Controller('drivers')
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  /**
   * Public Endpoint: Driver Self-Registration.
   * Creates the account and signs the driver in, returning the same
   * tokens as the sign-in endpoints (refresh token also set as a cookie).
   */
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

  /**
   * Protected Endpoint: Driver Profile Update.
   * Restricted strictly to authenticated users with the DRIVER role.
   */
  @Patch('profile')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.DRIVER)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: PatchDriverProfileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user.sub;
    const phoneVerifiedAt = dto.m_number ? new Date() : undefined;

    return this.driverService.updateProfile(userId, dto, phoneVerifiedAt);
  }

  /**
   * Public Endpoint: Forgot-password, wizard step 2. Sends a 6-digit code
   * (SMS or email, depending on the identity given). The response is the
   * same whether or not an account matches.
   */
  @Post('forgot-password/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: PasswordResetIdentityDto,
  ): Promise<OtpRequestResult> {
    return this.driverService.requestPasswordResetOtp(dto);
  }

  /**
   * Public Endpoint: Forgot-password, wizard step 3. Identity + code + new
   * password in one request; the password changes only if the code is valid.
   */
  @Post('forgot-password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: ResetPasswordDto,
  ): Promise<void> {
    return this.driverService.resetPassword(dto);
  }
}