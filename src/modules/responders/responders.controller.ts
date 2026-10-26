import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Patch,
  Req,
  UseGuards,
  ValidationPipe,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/role.decorator';
import { ApiRoles } from '../../common/decorators/api-roles.decorator';
import { Role } from '../../common/enums/role-enum';
import { AvailabilityStatusEnum } from './enums/availability-status.enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthTokens } from '../auth/interfaces/auth-token.interface';
import { ResponderService } from './responders.service';
import { CreateResponderDto } from './dto/create-responder.dto';
import { PatchResponderProfileDto } from './dto/patch-responder-profile.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PasswordResetIdentityDto } from './dto/password-reset-identity.dto';
import { ResetPasswordDto } from './dto/password-reset.dto';
import { OtpRequestResult } from './interfaces/otp-result.interface';
import { ResetTokenResult } from './interfaces/result-token-result.interface';
import { UserIdType } from './types/user-id.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GoOnDutyDto } from './dto/go-on-duty.dto';
import { DutyChangeResponse } from './responders.service';
import { ChangePassAndIssueNewRefreshTokenDTO } from './dto/change-pass-and-new-refresh.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('responders')
@ApiTags('Responders')
@ApiBearerAuth('access-token')
export class RespondersController {
  constructor(private readonly responderService: ResponderService) {}

  @Post()
  @ApiOperation({ summary: 'Create a responder or administrator account' })
  @ApiBody({ type: CreateResponderDto })
  @ApiResponse({ status: 201, description: 'Account created' })
  @ApiResponse({ status: 400, description: 'Invalid account data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.ADMIN, Role.SUPER)
  async createResponder(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateResponderDto,
    @Req() req: AuthenticatedRequest,
    @CurrentUser('sub') userId: string,
  ): Promise<UserIdType> {
    const { role, command_center_id: jwtCcId } = req.user;

    let targetCommandCenterId: string;

    if (role === Role.SUPER) {
      if (!dto.command_center_id) {
        throw new BadRequestException(
          'Superadmin must explicitly provide command_center_id in the body.',
        );
      }
      targetCommandCenterId = dto.command_center_id;
    } else {
      if (!jwtCcId) {
        throw new ForbiddenException(
          'Your account is not attached to a command center.',
        );
      }
      targetCommandCenterId = jwtCcId;
    }

    return this.responderService.createResponder(
      dto,
      targetCommandCenterId,
      userId,
    );
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get the authenticated responder profile' })
  @ApiResponse({ status: 200, description: 'Responder profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async getProfile(@CurrentUser('sub') userId: string) {
    return this.responderService.getProfile(userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update the authenticated responder profile' })
  @ApiBody({ type: PatchResponderProfileDto })
  @ApiResponse({ status: 200, description: 'Responder profile updated' })
  @ApiResponse({ status: 400, description: 'Invalid profile data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async updateProfile(
    @Body() dto: PatchResponderProfileDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.responderService.updateProfile(userId, dto);
  }

  @Patch('change-password')
  @ApiOperation({
    summary: 'Change the authenticated account password and issue new tokens',
    description:
      'Verifies the current password, hashes and stores the new one, then ' +
      'issues a fresh access/refresh pair. For non-SUPER accounts all of the ' +
      "user's other sessions are invalidated as part of the new session — " +
      'every other device must sign in again.',
  })
  @ApiBody({ type: ChangePassAndIssueNewRefreshTokenDTO })
  @ApiResponse({
    status: 200,
    description: 'Password changed; new access and refresh tokens issued',
  })
  @ApiResponse({
    status: 400,
    description: 'New password violates policy, or equals the current one',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized, or current password is incorrect',
  })
  @ApiResponse({
    status: 403,
    description: 'dto.id does not match the authenticated account',
  })
  @ApiResponse({ status: 404, description: 'Responder account not found' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  @ApiRoles(Role.RESPONDER, Role.ADMIN, Role.SUPER)
  async changePassword(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: ChangePassAndIssueNewRefreshTokenDTO,
    @CurrentUser('sub') userId: string,
  ): Promise<AuthTokens> {
    return this.responderService.changePassword(
      userId,
      dto.old_password,
      dto.new_password,
    );
  }

  @Post('request-mnumber-otp')
  @ApiOperation({ summary: 'Request OTP to verify a responder mobile number' })
  @ApiBody({ type: SendOtpDto })
  @ApiResponse({ status: 201, description: 'OTP request accepted' })
  @ApiResponse({ status: 400, description: 'Invalid mobile number' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async requestMnumberOtp(
    @Body() dto: SendOtpDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.responderService.requestMnumberOtp(userId, dto);
  }

  @Post('verify-mnumber-otp')
  @ApiOperation({ summary: 'Verify a responder mobile number OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 201, description: 'Mobile number verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async verifyMnumberOtp(
    @Body() dto: VerifyOtpDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.responderService.verifyMnumberOtp(userId, dto);
  }

  @Post('forgot-password/request')
  @ApiOperation({ summary: 'Request a responder password reset OTP' })
  @ApiBody({ type: PasswordResetIdentityDto })
  @ApiResponse({ status: 202, description: 'Password reset request accepted' })
  @ApiResponse({ status: 400, description: 'Invalid identity information' })
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: PasswordResetIdentityDto,
  ): Promise<OtpRequestResult> {
    return this.responderService.requestPasswordResetOtp(dto);
  }

  @Post('forgot-password/verify')
  @ApiOperation({ summary: 'Verify a responder password reset OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, description: 'Reset token issued' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  @HttpCode(HttpStatus.OK)
  async verifyPasswordResetOtp(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: VerifyOtpDto,
  ): Promise<ResetTokenResult> {
    return this.responderService.verifyPasswordResetOtp(dto);
  }

  @Post('forgot-password/reset')
  @ApiOperation({ summary: 'Reset a responder password' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 204, description: 'Password reset' })
  @ApiResponse({ status: 400, description: 'Invalid reset token or password' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: ResetPasswordDto,
  ): Promise<void> {
    return this.responderService.resetPassword(dto);
  }

  @Post('duty/on')
  @ApiOperation({ summary: 'Put the authenticated responder on duty' })
  @ApiBody({ type: GoOnDutyDto })
  @ApiResponse({ status: 200, description: 'Responder is on duty' })
  @ApiResponse({ status: 400, description: 'Invalid duty duration' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async goOnDuty(
    @Body() dto: GoOnDutyDto,
    @CurrentUser('sub') userId: string,
  ): Promise<DutyChangeResponse> {
    return this.responderService.goOnDuty(userId, dto.duration_minutes);
  }

  @Post('duty/off')
  @ApiOperation({ summary: 'Take the authenticated responder off duty' })
  @ApiResponse({ status: 200, description: 'Responder is off duty' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async goOffDuty(
    @CurrentUser('sub') userId: string,
  ): Promise<DutyChangeResponse> {
    return this.responderService.goOffDuty(userId);
  }

  @Get('availability')
  @ApiOperation({
    summary: 'Fetch current availability status and shift expiry',
  })
  @ApiResponse({ status: 200, description: 'Responder availability returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtGuard, RolesGuard)
  @Roles(Role.RESPONDER)
  @ApiRoles(Role.RESPONDER)
  async getAvailability(@CurrentUser('sub') userId: string): Promise<{
    availability: AvailabilityStatusEnum;
    isOnDuty: boolean;
    shiftEndsAt: string | null;
    shiftSecondsLeft: number | null;
    dutyStatus: string | null;
  }> {
    return await this.responderService.getCurrentAvailability(userId);
  }
}
