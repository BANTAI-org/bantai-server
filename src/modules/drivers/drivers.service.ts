import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import type { Redis } from 'ioredis';
import { DriverRepository } from './drivers.repository';
import { CreateDriverDto } from './dto/create-driver.dto';
import {
  PatchDriverProfileDto,
  toDriverProfilePatch,
  toUserAccountPatch,
} from './dto/patch-driver-profile.dto';
import { PasswordResetIdentityDto } from './dto/password-reset-identity.dto';
import { ResetPasswordDto } from './dto/password-reset.dto';
import { CreateDriverProfileData } from './types/create-driver-profile.types';
import { CreateDriverUserAccount } from './types/create-driver-account.type';
import { DriverProfileDataRow } from './types/driver-profile-data-row.type';
import { UserAccountPatch } from './types/patch-user-account.type';
import {
  DriverPasswordTarget,
  ResetIdentity,
} from './types/password-reset-types';
import { UserIdType } from '../responders/types/user-id.types';
import { AuthProviderEnum } from '../responders/enums/auth-provider.enum';
import { ServiceProviderEnum } from '../responders/enums/service-provider.enum';
import {
  EMAIL_OTP_TTL_SECONDS,
  EmailOtpService,
} from '../email/email-otp.service';
import { REDIS_CLIENT } from '../redis/provider/redis.provider';
import { SmsService } from '../sms/sms.service';
import {
  SOCIAL_IDENTITY_VERIFIERS,
  type SocialIdentityVerifiers,
} from './types/social-identity-provider.type';
import { isPastDate } from './util/is-past-date.util';
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
} from './util/otp-policey.util';
import { OtpRequestResult } from './interfaces/otp-result.interface';
import { ResetTokenResult } from './interfaces/result-token-result.interface';
import { hasChanges } from './util/has-changes.util';
import { UserIdDTO } from './dto/user-id.dto';
import { DutyStatusEnum } from './enums/duty-status.enum';
import { Role } from '../../common/enums/role-enum';
import { AuthService } from '../auth/auth.service';
import { AuthTokens } from '../auth/interfaces/auth-token.interface';
import { VerifyOtpDto } from './dto/verify-otp.dto';

type IdentityFields = Pick<
  CreateDriverUserAccount,
  | 'email'
  | 'auth_provider'
  | 'provider_id'
  | 'password_hash'
  | 'email_verified_at'
>;

const RESET_TOKEN_TTL_SECONDS = 10 * 60;
const RESET_SESSION_EXPIRED_MESSAGE =
  'Your reset session expired. Please request a new code.';

/** Only a hash of the reset token ever touches Redis. */
const resetTokenKey = (token: string): string =>
  `pwreset:token:${createHash('sha256').update(token).digest('hex')}`;

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);

  constructor(
    private readonly driverRepository: DriverRepository,
    @Inject(SOCIAL_IDENTITY_VERIFIERS)
    private readonly socialVerifiers: SocialIdentityVerifiers,
    private readonly smsService: SmsService,
    private readonly emailOtpService: EmailOtpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly authService: AuthService,
  ) {}

  async createDriver(
    dto: CreateDriverDto,
    phoneVerifiedAt: Date,
  ): Promise<UserIdType> {
    if (!isPastDate(dto.date_of_birth)) {
      throw new BadRequestException('date_of_birth must be in the past');
    }

    if (
      dto.service_provider !== ServiceProviderEnum.INDEPENDENT &&
      !dto.service_id
    ) {
      throw new BadRequestException(
        `service_id is required when service provider is ${dto.service_provider}`,
      );
    }

    const identity = await this.resolveIdentity(dto);

    const userData: CreateDriverUserAccount = {
      f_name: dto.f_name,
      l_name: dto.l_name,
      m_name: dto.m_name ?? null,
      m_number: dto.m_number,
      ...identity,
      phone_verified_at: phoneVerifiedAt,
    };

    const profileData: CreateDriverProfileData = {
      service_provider: dto.service_provider,
      service_id:
        dto.service_provider === ServiceProviderEnum.INDEPENDENT
          ? null
          : (dto.service_id ?? null),
      plate_number: dto.plate_number,
      blood_type: dto.blood_type,
      address: dto.address,
      date_of_birth: dto.date_of_birth,
      emergency_contacts: dto.emergency_contacts,
      license_number: dto.license_number,
      license_expires_at: dto.license_expires_at,
      years_riding: dto.years_riding,
      fleet_operator_id: dto.fleet_operator_id ?? null,
      vehicle_model: dto.vehicle_model,
      vehicle_color: dto.vehicle_color,
      medical_conditions: dto.medical_conditions,
      data_sharing_consented_at: new Date(),
    };

    try {
      return await this.driverRepository.createDriverAccount(
        userData,
        profileData,
      );
    } catch (error: unknown) {
      this.rethrowDbError(error, 'createDriver');
    }
  }

  /**
   * Final step of the registration wizard: creates the driver, then
   * signs them straight in. The person just proved who they are more
   * strongly than a login would (SMS code plus password or social
   * token), so asking them to sign in again adds friction and no
   * security.
   *
   * Account creation and token issuing are separate steps on purpose.
   * If issuing tokens fails after the account is committed, the
   * driver is told so and can simply sign in, instead of seeing a
   * failed registration for an account that exists.
   *
   * @param phoneVerifiedAt Set by the OTP layer after the code checks
   *   out, never taken from the request body.
   */
  async registerDriver(
    dto: CreateDriverDto,
    phoneVerifiedAt: Date,
  ): Promise<AuthTokens & UserIdType> {
    const { id } = await this.createDriver(dto, phoneVerifiedAt);

    try {
      // Drivers belong to no command center, hence null.
      const tokens = await this.authService.generateTokens(
        id,
        Role.DRIVER,
        null,
      );
      return { id, ...tokens };
    } catch (error: unknown) {
      this.logger.error(
        `Driver ${id} was created but signing them in failed`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Your account was created, but we could not sign you in. Please sign in.',
      );
    }
  }

  async updateProfile(
    userId: string,
    dto: PatchDriverProfileDto,
    phoneVerifiedAt?: Date,
  ): Promise<DriverProfileDataRow> {
    const accountPatch: UserAccountPatch = toUserAccountPatch(dto);
    const profilePatch = toDriverProfilePatch(dto);

    if (!hasChanges(accountPatch) && !hasChanges(profilePatch)) {
      throw new BadRequestException('No fields provided to update');
    }

    if (accountPatch.m_number !== undefined) {
      if (!phoneVerifiedAt) {
        throw new BadRequestException(
          'A new mobile number must be verified with an OTP code',
        );
      }
      accountPatch.phone_verified_at = phoneVerifiedAt;
    }

    if (
      profilePatch.date_of_birth !== undefined &&
      !isPastDate(profilePatch.date_of_birth)
    ) {
      throw new BadRequestException('date_of_birth must be in the past');
    }

    if (profilePatch.service_provider === ServiceProviderEnum.INDEPENDENT) {
      profilePatch.service_id = null;
    }

    let profile: DriverProfileDataRow | null;
    try {
      profile = await this.driverRepository.patchDriverComposite(
        userId,
        accountPatch,
        profilePatch,
      );
    } catch (error: unknown) {
      this.rethrowDbError(error, 'updateProfile');
    }

    if (!profile) {
      throw new NotFoundException('Driver account not found');
    }
    return profile;
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
  ): Promise<OtpRequestResult> {
    const identity = this.pickResetIdentity(dto);
    const driver = await this.findPasswordResetTarget(identity);

    if (driver) {
      void this.dispatchResetOtp(identity, driver).catch((error: unknown) => {
        this.logger.error(
          `Password-reset OTP could not be sent to driver ${driver.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }

    return {
      expires_in_seconds: EMAIL_OTP_TTL_SECONDS,
      resend_after_seconds: RESET_RESEND_COOLDOWN_SECONDS,
    };
  }

  /**
   * Step 2: verifies the code. On success the code is spent and a
   * single-use reset token is issued, which step 3 requires.
   */
  async verifyPasswordResetOtp(dto: VerifyOtpDto): Promise<ResetTokenResult> {
    const identity = this.pickResetIdentity(dto);
    const driver = await this.findPasswordResetTarget(identity);
    if (!driver) throw new BadRequestException(INVALID_CODE_MESSAGE);

    // 6 digits is only 1,000,000 guesses, so cap them per account.
    const attempts = await this.hitCounter(
      `pwreset:attempts:${driver.id}`,
      EMAIL_OTP_TTL_SECONDS,
    );
    if (attempts > RESET_MAX_VERIFY_ATTEMPTS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many incorrect attempts. Please request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Throws on a wrong, expired or reused code. Nothing below runs then.
    await this.verifyResetCode(
      this.resetChannelFor(identity, driver),
      dto.otp_code,
    );

    await this.redis.del(`pwreset:attempts:${driver.id}`);

    const resetToken = randomBytes(32).toString('hex');
    await this.redis.set(
      resetTokenKey(resetToken),
      driver.id,
      'EX',
      RESET_TOKEN_TTL_SECONDS,
    );

    return {
      reset_token: resetToken,
      expires_in_seconds: RESET_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * Step 3: spends the reset token and sets the new password. Signs the
   * driver out everywhere.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // GETDEL (Redis >= 6.2) reads and deletes atomically, so a token can
    // never be used twice, even by two simultaneous requests.
    const driverId = await this.redis.getdel(resetTokenKey(dto.reset_token));
    if (!driverId) throw new BadRequestException(RESET_SESSION_EXPIRED_MESSAGE);

    // Hash only AFTER the token is good, so unauthenticated callers can't
    // make the server burn bcrypt time.
    const passwordHash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);

    let updated: boolean;
    try {
      updated = await this.driverRepository.resetPasswordAndRevokeSessions(
        driverId,
        passwordHash,
      );
    } catch (error: unknown) {
      this.rethrowDbError(error, 'resetPassword');
    }
    if (!updated) throw new BadRequestException(RESET_SESSION_EXPIRED_MESSAGE);
  }

  private async dispatchResetOtp(
    identity: ResetIdentity,
    driver: DriverPasswordTarget,
  ): Promise<void> {
    // Keyed by account id, so switching between id / email / phone can't
    // get around the limits.
    const cooldownKey = `pwreset:cooldown:${driver.id}`;
    const claimed = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      RESET_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (claimed === null) return;

    const sends = await this.hitCounter(
      `pwreset:sends:${driver.id}`,
      HOUR_SECONDS,
    );
    if (sends > RESET_MAX_SENDS_PER_HOUR) return;

    const channel = this.resetChannelFor(identity, driver);
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
    await this.redis.del(`pwreset:attempts:${driver.id}`);
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
    identity: ResetIdentity,
    driver: DriverPasswordTarget,
  ): OtpChannel {
    if (identity.kind === 'email') {
      return { type: 'email', email: driver.email.toLowerCase() };
    }
    if (identity.kind === 'm_number') {
      return { type: 'sms', phone: identity.value };
    }
    return driver.m_number
      ? { type: 'sms', phone: driver.m_number }
      : { type: 'email', email: driver.email.toLowerCase() };
  }

  private pickResetIdentity(dto: PasswordResetIdentityDto): ResetIdentity {
    const provided: ResetIdentity[] = [];
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
    identity: ResetIdentity,
  ): Promise<DriverPasswordTarget | null> {
    try {
      return await this.driverRepository.findDriverForPasswordReset(identity);
    } catch (error: unknown) {
      this.rethrowDbError(error, 'findDriverForPasswordReset');
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

  private async resolveIdentity(dto: CreateDriverDto): Promise<IdentityFields> {
    switch (dto.auth_provider) {
      case AuthProviderEnum.LOCAL: {
        if (!dto.password) {
          throw new BadRequestException('Password is required');
        }
        return {
          email: dto.email.trim().toLowerCase(),
          auth_provider: AuthProviderEnum.LOCAL,
          provider_id: null,
          password_hash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
          email_verified_at: null,
        };
      }

      case AuthProviderEnum.GOOGLE:
      case AuthProviderEnum.APPLE: {
        if (!dto.social_id_token) {
          throw new BadRequestException('social_id_token is required');
        }
        try {
          const verified = await this.socialVerifiers[dto.auth_provider].verify(
            dto.social_id_token,
          );
          return {
            email: verified.email.trim().toLowerCase(),
            auth_provider: dto.auth_provider,
            provider_id: verified.provider_id,
            password_hash: null,
            email_verified_at: new Date(),
          };
        } catch (error: unknown) {
          this.logger.warn(
            `${dto.auth_provider} token verification failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          throw new UnauthorizedException('Invalid or expired sign-in token');
        }
      }

      default:
        throw new BadRequestException('Unsupported auth provider');
    }
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
        if (constraint.includes('license_number')) {
          throw new ConflictException('License number is already registered');
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

  async getDriverProfile(id: string): Promise<DriverProfileDataRow | null> {
    const driverProfile = await this.driverRepository.findProfileById(id);
    return driverProfile ?? null;
  }

  async changeDriverStatus(dto: UserIdDTO): Promise<boolean> {
    const { id } = dto;
    try {
      const currentDutyStatus =
        await this.driverRepository.checkCurrentDutyStatus(id);

      if (!currentDutyStatus) {
        throw new NotFoundException('Account with id doesnt exist');
      }

      const new_duty =
        currentDutyStatus === DutyStatusEnum.ON_DUTY
          ? DutyStatusEnum.OFF_DUTY
          : DutyStatusEnum.ON_DUTY;

      const response = await this.driverRepository.changeDuty(id, new_duty);
      return response;
    } catch (error: unknown) {
      this.logger.error(
        'error in changing duty: ',
        error instanceof Error ? error.stack : undefined,
      );
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Unknown error occured');
    }
  }
}
