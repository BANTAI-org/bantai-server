import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ResponderRepository } from './responders.repository';
import { AuthService } from '../auth/auth.service';
import { Role } from '../../common/enums/role-enum';
import { GeoPoint } from '../../common/interfaces/geo-location.interface';
import { AgencyTypeEnum } from './enums/agency-type.enum';
import { AvailabilityStatusEnum } from './enums/availability-status.enum';
import { PoliceRank } from './enums/police-rank.enum';
import { CreateResponderDto } from './dto/create-responder.dto';
import { CreateNewResponderUserAccount } from './types/create-new-user.types';
import { CreateResponderProfileData } from './types/create-responder-profile.type';
import { DutyChangeResult } from './types/duty-change-result';
import { UserIdType } from './types/user-id.types';
import { LiveLocation, RedisService } from '../redis/redis.service';

const PG_UNIQUE_VIOLATION = '23505';

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
}
