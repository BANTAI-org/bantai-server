import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import {
  ResponderRepository,
  type ResponderAccountPatch,
  ResponderPasswordTarget,
  ResponderResetIdentity,
  // PASSWORD_RESET_LOOKUP,
} from './responders.repository';
import { AuthService } from '../auth/auth.service';
import { Role } from '../../common/enums/role-enum';
import { GeoPoint } from '../../common/interfaces/geo-location.interface';
import { AgencyTypeEnum } from './enums/agency-type.enum';
import { AvailabilityStatusEnum } from './enums/availability-status.enum';
import { PoliceRank } from './enums/police-rank.enum';
import { CreateResponderDto } from './dto/create-responder.dto';
import { PatchResponderProfileDto } from './dto/patch-responder-profile.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PasswordResetIdentityDto } from './dto/password-reset-identity.dto';
import { ResetPasswordDto } from './dto/password-reset.dto';
import { CreateNewResponderUserAccount } from './types/create-new-user.types';
import { CreateResponderProfileData } from './types/create-responder-profile.type';
import { DutyChangeResult } from './types/duty-change-result';
import { UserIdType } from './types/user-id.types';
import { LiveLocation, RedisService } from '../redis/redis.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SmsService } from '../sms/sms.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import type { Redis } from 'ioredis';
import {
  EMAIL_OTP_TTL_SECONDS,
  EmailOtpService,
} from '../email/email-otp.service';
import { REDIS_CLIENT } from '../redis/provider/redis.provider';
import {} from // SOCIAL_IDENTITY_VERIFIERS,
// type SocialIdentityVerifiers,
'./types/social-identity-provider.type';
// import { isPastDate } from './util/is-past-date.util';
import { isPgError } from './util/pg-error.util';
import { OtpChannel } from './types/otp-channel.type';
import {
  BCRYPT_ROUNDS,
  PG_UNIQUE_VIOLATION,
  HOUR_SECONDS,
  INVALID_CODE_MESSAGE,
  PG_CHECK_VIOLATION,
  PG_DATA_EXCEPTION_CLASS,
  PG_NOT_NULL_VIOLATION,
  RESET_MAX_SENDS_PER_HOUR,
  RESET_MAX_VERIFY_ATTEMPTS,
  RESET_OTP_PURPOSE,
  RESET_RESEND_COOLDOWN_SECONDS,
  RESET_TOKEN_TTL_SECONDS,
  RESET_SESSION_EXPIRED_MESSAGE,
} from './util/otp-policey.util';

// const PG_UNIQUE_VIOLATION = '23505';

/** No timer chosen -> a 12 h shift, so the geofenced "off duty" can never strand anyone. */
const DEFAULT_SHIFT_MINUTES = 12 * 60;
/** The GPS fix used for the geofence check must be this recent. */
const MAX_LOCATION_AGE_MS = 30_000;
/** A fix reporting a worse accuracy radius than this can't be trusted against a 50 m fence. */
const MAX_ACCEPTED_ACCURACY_METERS = 30;

export interface DutyChangeResponse {
  availability: AvailabilityStatusEnum;
  shift_ends_at: string | null;
}

@Injectable()
export class ResponderService {
  private readonly logger = new Logger(ResponderService.name);

  constructor(
    private readonly responderRepository: ResponderRepository,
    private readonly authService: AuthService,
    private readonly redisService: RedisService,
    private readonly auditLogsService: AuditLogsService,
    private readonly smsService: SmsService,
    private readonly emailOtpService: EmailOtpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Provisions an account in `pending_activation` (no password), then
   * issues an activation token and emails the link. Despite the
   * method name, this now creates either a responder OR an admin —
   * dto.role picks which, defaulting to Role.RESPONDER when omitted.
   * `super` can never reach this method: CreateResponderDto's @IsIn
   * rejects it at the validation layer before the request body is
   * even parsed into a class instance.
   *
   * agency/call_sign/rank (r_profile data) only apply on the
   * responder branch — an admin account gets no r_profile row at all,
   * see ResponderRepository.
   *
   * The two steps (DB write, then email) are deliberately NOT one
   * transaction. The account must be committed before a token can
   * reference it, and an email can't be rolled back anyway. If the
   * email step fails the account still exists and stays pending, so
   * the caller is told exactly that and can resend the link instead
   * of re-creating the account.
   *
   * @param dto Validated, normalized request body.
   * @param commandCenterId The calling admin's own command center, from
   *   their JWT. Never taken from the request body.
   * @returns The new account's id.
   * @throws {BadRequestException} If agency-specific rules aren't met
   *   for a responder, or agency is missing on a responder request.
   * @throws {ConflictException} If the email is already registered.
   * @throws {InternalServerErrorException} If creation fails, or the
   *   account was created but the activation email couldn't be sent.
   */
  async createResponder(
    dto: CreateResponderDto,
    commandCenterId: string,
  ): Promise<UserIdType> {
    const role = dto.role ?? Role.RESPONDER;

    const profileData = this.buildProfileDataIfResponder(role, dto);

    const userData: CreateNewResponderUserAccount = {
      f_name: dto.f_name,
      l_name: dto.l_name,
      m_name: dto.m_name ?? null,
      email: dto.email,
      role,
      command_center_id: commandCenterId,
    };

    let created: UserIdType;
    try {
      created = await this.responderRepository.createResponderProfile(
        userData,
        profileData,
      );
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      this.logger.error(
        'Failed to create account',
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException('Failed to create account.');
    }

    try {
      await this.authService.createActivationToken(created.id, dto.email);
    } catch (err: unknown) {
      this.logger.error(
        `Account ${created.id} was created but the activation email failed`,
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException(
        'The account was created, but the activation email could not be sent. Resend the activation link instead of creating the account again.',
      );
    }

    // Create audit log for responder account creation
    try {
      const auditInput = {
        actorId: commandCenterId,
        commandCenterId,
        action: AuditAction.CREATE_USER,
        targetEntity: 'user_account',
        targetId: created.id,
        oldPayload: null,
        newPayload: {
          id: created.id,
          f_name: dto.f_name,
          l_name: dto.l_name,
          m_name: dto.m_name ?? null,
          email: dto.email,
          role: dto.role ?? Role.RESPONDER,
          command_center_id: commandCenterId,
        },
      };

      await this.auditLogsService.createAudit(auditInput);
    } catch (auditError: unknown) {
      this.logger.warn(
        `Failed to create audit log for responder ${created.id}: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
      );
    }

    return created;
  }

  // ---------------------------------------------------------------
  // Duty status
  // ---------------------------------------------------------------

  /**
   * Goes on duty. The position used for the geofence comes from Redis
   * (written by the device's own pings), never from the request, so it
   * can't be faked in the body. durationMinutes sets the auto-end timer.
   */
  async goOnDuty(
    userId: string,
    durationMinutes?: number,
  ): Promise<DutyChangeResponse> {
    const location = await this.requireFreshLocation(userId);
    const shiftEndsAt = new Date(
      Date.now() + (durationMinutes ?? DEFAULT_SHIFT_MINUTES) * 60_000,
    );

    const result = await this.runDutyChange('go on duty', userId, () =>
      this.responderRepository.setOnDutyAvailability(
        userId,
        location,
        shiftEndsAt,
      ),
    );
    this.assertDutyChanged(result, AvailabilityStatusEnum.ON_DUTY);

    return {
      availability: AvailabilityStatusEnum.ON_DUTY,
      shift_ends_at: shiftEndsAt.toISOString(),
    };
  }

  async goOffDuty(userId: string): Promise<DutyChangeResponse> {
    const location = await this.requireFreshLocation(userId);

    const result = await this.runDutyChange('go off duty', userId, () =>
      this.responderRepository.setOffDutyAvailability(userId, location),
    );
    this.assertDutyChanged(result, AvailabilityStatusEnum.OFF_DUTY);

    await this.stopTracking(userId);
    return {
      availability: AvailabilityStatusEnum.OFF_DUTY,
      shift_ends_at: null,
    };
  }

  /**
   * Timer expiry sweep. NOT geofenced: when the timer runs out the shift
   * ends wherever the responder is. Call it every 30-60 s from a
   * scheduler. Never throws, so a failed tick can't kill the scheduler.
   *
   * @returns How many responders were set off duty.
   */
  async expireDueShifts(): Promise<number> {
    let userIds: string[];
    try {
      userIds = await this.responderRepository.expireDueShifts();
    } catch (err: unknown) {
      this.logger.error(
        'Shift expiry sweep failed',
        err instanceof Error ? err.stack : undefined,
      );
      return 0;
    }

    await Promise.all(userIds.map((id) => this.stopTracking(id)));
    return userIds.length;
  }

  private async requireFreshLocation(userId: string): Promise<GeoPoint> {
    let fix: LiveLocation | null;
    try {
      fix = await this.redisService.getFresh(userId, MAX_LOCATION_AGE_MS);
    } catch (err: unknown) {
      this.logger.error(
        `Could not read live location for ${userId}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Location service is unavailable. Please try again shortly.',
      );
    }

    if (!fix) {
      throw new BadRequestException(
        'Your location is not available. Make sure GPS is on, wait a few seconds, and try again.',
      );
    }
    if (
      fix.accuracy_meters !== null &&
      fix.accuracy_meters > MAX_ACCEPTED_ACCURACY_METERS
    ) {
      throw new BadRequestException(
        `GPS signal is too weak (accuracy about ${Math.round(fix.accuracy_meters)} m). Move to an open area and try again.`,
      );
    }

    return { latitude: fix.latitude, longitude: fix.longitude };
  }

  private async runDutyChange(
    action: string,
    userId: string,
    operation: () => Promise<DutyChangeResult>,
  ): Promise<DutyChangeResult> {
    try {
      return await operation();
    } catch (err: unknown) {
      this.logger.error(
        `Failed to ${action} for responder ${userId}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(
        'An unexpected error occurred while updating your duty status.',
      );
    }
  }

  private assertDutyChanged(
    result: DutyChangeResult,
    target: AvailabilityStatusEnum,
  ): void {
    const label =
      target === AvailabilityStatusEnum.ON_DUTY ? 'on duty' : 'off duty';

    switch (result.status) {
      case 'UPDATED':
        return;
      case 'NOT_FOUND':
        throw new NotFoundException('Responder profile not found.');
      case 'OUT_OF_RANGE':
        throw new ForbiddenException(
          `You are about ${Math.round(result.distance_meters)} m from your command center. Move closer to go ${label}.`,
        );
      case 'INVALID_STATE':
        throw new ConflictException(
          this.invalidStateMessage(target, result.availability, label),
        );
    }
  }

  private invalidStateMessage(
    target: AvailabilityStatusEnum,
    current: AvailabilityStatusEnum,
    label: string,
  ): string {
    if (current === target) return `You are already ${label}.`;
    if (
      current === AvailabilityStatusEnum.DISPATCHED ||
      current === AvailabilityStatusEnum.EN_ROUTE
    ) {
      return 'You are handling an incident. Finish it before changing your duty status.';
    }
    return 'Your status just changed. Please try again.';
  }

  /** Drop the responder from the nearby index. Never fails the request. */
  private async stopTracking(userId: string): Promise<void> {
    try {
      await this.redisService.remove(userId, 'responder');
    } catch (err: unknown) {
      this.logger.warn(
        `Could not clear live location for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Only responders get r_profile data. Returns undefined for admin,
   * so the repository skips the r_profile insert entirely rather than
   * writing agency/call_sign/rank that wouldn't mean anything for that
   * role.
   *
   * dto.agency is re-checked here (not just trusted from DTO
   * validation) so a missing value produces this method's own
   * readable 400 rather than depending solely on the DTO layer having
   * run correctly — same defensive-in-depth reasoning as
   * assertAgencyRules below.
   */
  private buildProfileDataIfResponder(
    role: Role,
    dto: CreateResponderDto,
  ): CreateResponderProfileData | undefined {
    if (role !== Role.RESPONDER) {
      return undefined;
    }

    const agency = dto.agency;
    if (!agency) {
      throw new BadRequestException(
        'agency is required when creating a responder.',
      );
    }

    const rank = dto.rank ?? PoliceRank.NONE;
    this.assertAgencyRules(agency, dto.call_sign, rank);

    return {
      agency,
      call_sign: dto.call_sign ?? null,
      rank,
    };
  }

  /**
   * Cross-field rules that mirror chck_agency_requirements in the
   * schema, checked here so the caller gets a readable 400 instead of
   * a raw constraint violation:
   *   - police: call sign required, and rank must be a real rank
   *   - mdrrmo: call sign required
   *   - barangay_tanod: neither required
   */
  private assertAgencyRules(
    agency: AgencyTypeEnum,
    callSign: string | undefined,
    rank: PoliceRank,
  ): void {
    if (
      agency === AgencyTypeEnum.POLICE &&
      (!callSign || rank === PoliceRank.NONE)
    ) {
      throw new BadRequestException(
        'Police responders require a call sign and a rank.',
      );
    }
    if (agency === AgencyTypeEnum.MDRRMO && !callSign) {
      throw new BadRequestException('MDRRMO responders require a call sign.');
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Fetches the responder profile for the given user ID.
   * Only returns data for responders (not admins).
   */
  async getProfile(
    userId: string,
  ): ReturnType<ResponderRepository['findProfileById']> {
    return this.responderRepository.findProfileById(userId);
  }

  /**
   * Updates the responder profile. Only m_number is editable for data integrity.
   * Requires phone_verified_at when changing m_number to ensure OTP verification.
   */
  async updateProfile(
    userId: string,
    dto: PatchResponderProfileDto,
  ): ReturnType<ResponderRepository['findProfileById']> {
    const accountPatch: ResponderAccountPatch = {};

    if (dto.m_number !== undefined) {
      if (!dto.phone_verified_at) {
        throw new BadRequestException(
          'A new mobile number must be verified with an OTP code',
        );
      }
      accountPatch.m_number = dto.m_number;
      accountPatch.phone_verified_at = new Date(dto.phone_verified_at);
    }

    if (Object.keys(accountPatch).length === 0) {
      return this.responderRepository.findProfileById(userId);
    }

    await this.responderRepository.updateUserAccount(userId, accountPatch);
    return this.responderRepository.findProfileById(userId);
  }

  /**
   * Sends an OTP to the specified mobile number for verification.
   * Uses the same SMS service as the drivers module.
   */
  async requestMnumberOtp(
    userId: string,
    dto: SendOtpDto,
  ): Promise<{ expiresIn: number }> {
    // Use the m_number from dto if provided, otherwise fetch from user's profile
    const mNumber = dto.m_number;

    if (!mNumber) {
      // If no m_number provided in DTO, we might want to fetch from profile
      // But for security, we'll require it to be explicitly provided
      throw new BadRequestException('Mobile number is required');
    }

    // Send OTP via SMS service
    await this.smsService.sendOtp(mNumber);

    // Return expiration info (typically 10 minutes for OTP)
    return { expiresIn: 600 }; // 10 minutes in seconds
  }

  /**
   * Verifies the OTP code for the specified mobile number.
   * Uses the same SMS service as the drivers module.
   */
  async verifyMnumberOtp(
    userId: string,
    dto: VerifyOtpDto,
  ): Promise<{ verified: true; phone_verified_at: string }> {
    const { m_number, otp_code } = dto;

    if (!m_number) {
      throw new BadRequestException('Mobile number is required');
    }

    // Verify OTP via SMS service
    await this.smsService.verifyOtp(m_number, otp_code);

    // Return verification success with timestamp
    return {
      verified: true,
      phone_verified_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------
  // Forgot-password (3 steps)
  //   1. requestPasswordResetOtp: sends a 6-digit code (SMS or email)
  //   2. verifyPasswordResetOtp: checks the code, issues a reset token
  //   3. resetPassword: reset token + new password
  //
  // The OTP is spent in step 2, so the reset token is what proves to
  // step 3 that step 2 was passed.
  // ---------------------------------------------------------------

  /**
   * Always answers the same way, whether or not an account matches, so this
   * can't be used to find out who is registered. The send runs in the
   * background so response timing and provider errors can't leak that either.
   */
  async requestPasswordResetOtp(
    dto: PasswordResetIdentityDto,
  ): Promise<{ expiresIn: number; resendAfter: number }> {
    const identity = this.pickResetIdentity(dto);
    const responder = await this.findPasswordResetTarget(identity);

    if (responder) {
      void this.dispatchResetOtp(identity, responder).catch(
        (error: unknown) => {
          this.logger.error(
            `Password-reset OTP could not be sent to responder ${responder.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        },
      );
    }

    return {
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      resendAfter: RESET_RESEND_COOLDOWN_SECONDS,
    };
  }

  /**
   * Step 2: verifies the code. On success the code is spent and a
   * single-use reset token is issued, which step 3 requires.
   */
  async verifyPasswordResetOtp(dto: VerifyOtpDto): Promise<{
    resetToken: string;
    expiresIn: number;
  }> {
    const identity = this.pickResetIdentity(dto);
    const responder = await this.findPasswordResetTarget(identity);
    if (!responder) throw new BadRequestException(INVALID_CODE_MESSAGE);

    // 6 digits is only 1,000,000 guesses, so cap them per account.
    const attempts = await this.hitCounter(
      `pwreset:attempts:${responder.id}`,
      EMAIL_OTP_TTL_SECONDS,
    );
    if (attempts > RESET_MAX_VERIFY_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    // Throws on a wrong, expired or reused code. Nothing below runs then.
    await this.verifyResetCode(
      this.resetChannelFor(identity, responder),
      dto.otp_code,
    );

    await this.redis.del(`pwreset:attempts:${responder.id}`);

    const resetToken = randomBytes(32).toString('hex');
    await this.redis.set(
      this.resetTokenKey(resetToken),
      responder.id,
      'EX',
      RESET_TOKEN_TTL_SECONDS,
    );

    return {
      resetToken: resetToken,
      expiresIn: RESET_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Step 3: spends the reset token and sets the new password. Signs the
   * responder out everywhere.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // GETDEL (Redis >= 6.2) reads and deletes atomically, so a token can
    // never be used twice, even by two simultaneous requests.
    const responderId = await this.redis.getdel(
      this.resetTokenKey(dto.reset_token),
    );
    if (!responderId)
      throw new BadRequestException(RESET_SESSION_EXPIRED_MESSAGE);

    // Hash only AFTER the token is good, so unauthenticated callers can't
    // make the server burn bcrypt time.
    const passwordHash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);

    let updated: boolean;
    try {
      updated = await this.responderRepository.resetPasswordAndRevokeSessions(
        responderId,
        passwordHash,
      );
    } catch (error: unknown) {
      this.rethrowDbError(error, 'resetPassword');
    }
    if (!updated) throw new BadRequestException(RESET_SESSION_EXPIRED_MESSAGE);
  }

  private async dispatchResetOtp(
    identity: ResponderResetIdentity,
    responder: ResponderPasswordTarget,
  ): Promise<void> {
    // Keyed by account id, so switching between id / email / phone can't
    // get around the limits.
    const cooldownKey = `pwreset:cooldown:${responder.id}`;
    const claimed = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      RESET_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (claimed === null) return;

    const sends = await this.hitCounter(
      `pwreset:sends:${responder.id}`,
      HOUR_SECONDS,
    );
    if (sends > RESET_MAX_SENDS_PER_HOUR) return;

    const channel = this.resetChannelFor(identity, responder);
    try {
      if (channel.type === 'sms') {
        await this.smsService.sendOtp(channel.phone);
      } else {
        await this.emailOtpService.send(channel.email, RESET_OTP_PURPOSE);
      }
    } catch (error: unknown) {
      // Nothing was delivered, so don't make them wait out the cooldown.
      await this.redis.del(cooldownKey);
      throw error;
    }

    // A fresh code gets a fresh guess budget.
    await this.redis.del(`pwreset:attempts:${responder.id}`);
  }

  private async verifyResetCode(
    channel: OtpChannel,
    code: string,
  ): Promise<void> {
    if (channel.type === 'sms') {
      await this.smsService.verifyOtp(channel.phone, code);
      return;
    }
    const valid = await this.emailOtpService.verify(
      channel.email,
      RESET_OTP_PURPOSE,
      code,
    );
    if (!valid) throw new BadRequestException(INVALID_CODE_MESSAGE);
  }

  /** Email -> email code. Phone -> SMS. Id -> SMS to the phone on file, else email. */
  private resetChannelFor(
    identity: ResponderResetIdentity,
    responder: ResponderPasswordTarget,
  ): OtpChannel {
    if (identity.kind === 'email') {
      return { type: 'email', email: responder.email.toLowerCase() };
    }
    if (identity.kind === 'm_number') {
      return { type: 'sms', phone: identity.value };
    }
    return responder.m_number
      ? { type: 'sms', phone: responder.m_number }
      : { type: 'email', email: responder.email.toLowerCase() };
  }

  private pickResetIdentity(
    dto: PasswordResetIdentityDto,
  ): ResponderResetIdentity {
    const provided: ResponderResetIdentity[] = [];
    if (dto.id) provided.push({ kind: 'id', value: dto.id });
    if (dto.email) provided.push({ kind: 'email', value: dto.email });
    if (dto.m_number) provided.push({ kind: 'm_number', value: dto.m_number });

    const [only] = provided;
    if (provided.length !== 1 || !only) {
      throw new BadRequestException(
        'Provide exactly one of id, email or m_number.',
      );
    }
    return only;
  }

  private async findPasswordResetTarget(
    identity: ResponderResetIdentity,
  ): Promise<ResponderPasswordTarget | null> {
    try {
      return await this.responderRepository.findResponderForPasswordReset(
        identity,
      );
    } catch (error: unknown) {
      this.rethrowDbError(error, 'findResponderForPasswordReset');
    }
  }

  /** INCR + EXPIRE NX in one MULTI, so a counter can never be left without a TTL. */
  private async hitCounter(key: string, ttlSeconds: number): Promise<number> {
    const results = await this.redis
      .multi()
      .incr(key)
      .expire(key, ttlSeconds, 'NX')
      .exec();
    const count = results?.[0]?.[1];
    if (typeof count !== 'number') {
      throw new Error('Redis counter failed');
    }
    return count;
  }

  private resetTokenKey(token: string): string {
    return `pwreset:token:${createHash('sha256').update(token).digest('hex')}`;
  }

  private rethrowDbError(error: unknown, operation: string): never {
    if (isPgError(error)) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        const constraint = error.constraint ?? '';
        this.logger.warn(
          `${operation}: unique violation (${constraint || 'unknown'})`,
        );

        if (constraint.includes('m_number')) {
          throw new ConflictException('Mobile number is already registered');
        }
        if (constraint.includes('email')) {
          throw new ConflictException('Email address is already registered');
        }
        if (
          constraint.includes('user_identity') ||
          constraint.includes('provider')
        ) {
          throw new ConflictException(
            'This social account is already registered',
          );
        }

        throw new ConflictException(
          'An account with these details already exists',
        );
      }
      if (
        error.code === PG_CHECK_VIOLATION ||
        error.code === PG_NOT_NULL_VIOLATION ||
        error.code?.startsWith(PG_DATA_EXCEPTION_CLASS)
      ) {
        this.logger.warn(
          `${operation}: data rule violation (${error.code ?? 'unknown'}, ${error.constraint ?? 'no constraint'})`,
        );
        throw new BadRequestException('Submitted data is invalid');
      }
    }

    this.logger.error(
      `${operation} failed`,
      error instanceof Error ? error.stack : undefined,
    );
    throw new InternalServerErrorException();
  }
}
