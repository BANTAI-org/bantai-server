import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { RedisService, TrackedRole } from '../redis/redis.service';
import { REDIS_CLIENT } from '../redis/provider/redis.provider';
import { Role } from '../../common/enums/role-enum';
import { ShiftRepository } from './shift.repository';
import { ShiftStatusDto } from './dto/shift-status.dto';

/** How far ahead the ending-soon warning fires. */
const ENDING_SOON_MINUTES = 15;

/** TTL of the warn-dedupe key, in seconds. Slightly longer than the window. */
const WARN_TTL_SECONDS = (ENDING_SOON_MINUTES + 1) * 60;

/** Cap per sweep so a bad tick can't lock the DB for long. */
const MAX_PER_SWEEP = 50;

/**
 * Dedupe key for the ending-soon warning. Includes the shift_ends_at
 * epoch so extending a shift (which changes shift_ends_at) naturally
 * re-arms the warning for the new end.
 */
const warnKey = (userId: string, shiftEndsAt: Date): string =>
  `shift:warned:${userId}:${shiftEndsAt.getTime()}`;

@Injectable()
export class ShiftService {
  private readonly logger = new Logger(ShiftService.name);

  constructor(
    private readonly repo: ShiftRepository,
    private readonly redis: RedisService,
    @Inject(REDIS_CLIENT) private readonly redisRaw: Redis,
    private readonly events: EventEmitter2,
  ) {}

  // ==================================================================
  // Scheduler — one tick does both phases
  // ==================================================================

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron(): Promise<void> {
    await this.sweepEndingSoon();
    await this.sweepExpired();
  }

  // ==================================================================
  // Phase 1 — ending soon
  // ==================================================================

  private async sweepEndingSoon(): Promise<void> {
    await this.warnEndingSoonResponders();
    await this.warnEndingSoonDrivers();
  }

  private async warnEndingSoonResponders(): Promise<void> {
    try {
      const rows = await this.repo.findEndingSoonResponderIds(
        ENDING_SOON_MINUTES,
        MAX_PER_SWEEP,
      );
      for (const row of rows) {
        await this.warnOnce(row.user_id, row.shift_ends_at, 'responder');
      }
    } catch (error) {
      this.logger.error('Responder ending-soon sweep failed', error);
    }
  }

  private async warnEndingSoonDrivers(): Promise<void> {
    try {
      const rows = await this.repo.findEndingSoonDriverIds(
        ENDING_SOON_MINUTES,
        MAX_PER_SWEEP,
      );
      for (const row of rows) {
        await this.warnOnce(row.user_id, row.shift_ends_at, 'driver');
      }
    } catch (error) {
      this.logger.error('Driver ending-soon sweep failed', error);
    }
  }

  /**
   * Fires the warning at most once per (user, shift_ends_at) pair.
   *
   * SET NX with TTL is the dedupe: a second instance racing on the same
   * user sees NX fail and skips. The TTL naturally expires around the
   * shift's end, so an extended shift (new shift_ends_at → new key) gets
   * a fresh warning near the new end.
   */
  private async warnOnce(
    userId: string,
    shiftEndsAt: Date,
    role: TrackedRole,
  ): Promise<void> {
    const key = warnKey(userId, shiftEndsAt);

    try {
      const set = await this.redisRaw.set(
        key,
        '1',
        'EX',
        WARN_TTL_SECONDS,
        'NX',
      );
      if (set !== 'OK') return;
    } catch (error) {
      // Redis hiccup → skip the warning rather than spamming. The
      // auto-ended notification (from phase 2) is the load-bearing one.
      this.logger.warn(
        `Could not dedupe ending-soon warning for ${role} ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    this.events.emit('notification.created', {
      userId,
      title: 'Shift ending soon',
      body: `Your shift ends in about ${ENDING_SOON_MINUTES} minutes. Open the app and extend it if you need more time.`,
      type: 'shift_ending_soon',
      tone: 'attention',
      relatedEntity: 'shift',
      relatedEntityId: userId,
    });

    this.logger.log(
      `Warned ${role} ${userId}: shift ends at ${shiftEndsAt.toISOString()}`,
    );
  }

  // ==================================================================
  // Phase 2 — auto-expire
  // ==================================================================

  private async sweepExpired(): Promise<void> {
    await this.expireResponders();
    await this.expireDrivers();
  }

  private async expireResponders(): Promise<void> {
    try {
      const candidates = await this.repo.findExpiredResponderIds(MAX_PER_SWEEP);
      if (candidates.length === 0) return;

      const expiredUserIds =
        await this.repo.expireResponderShiftsBulk(candidates);
      if (expiredUserIds.length === 0) return;

      this.logger.log(`Auto-ended ${expiredUserIds.length} responder shift(s)`);

      for (const userId of expiredUserIds) {
        // The inbox row was already inserted by the transaction;
        // skipInbox avoids a duplicate.
        this.events.emit('notification.created', {
          userId,
          title: 'Shift ended',
          body: 'Your shift has ended automatically. You are now off duty.',
          type: 'shift_auto_ended',
          tone: 'info',
          relatedEntity: 'shift',
          relatedEntityId: userId,
          skipInbox: true,
        });

        // Best-effort: drop them from the wave-dispatch pool.
        await this.redis.remove(userId, 'responder').catch((error) => {
          this.logger.warn(
            `Failed to remove responder ${userId} from Redis after shift expiry`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      }
    } catch (error) {
      this.logger.error('Responder expiry sweep failed', error);
    }
  }

  private async expireDrivers(): Promise<void> {
    try {
      const candidates = await this.repo.findExpiredDriverIds(MAX_PER_SWEEP);
      if (candidates.length === 0) return;

      const expiredUserIds = await this.repo.expireDriverShiftsBulk(candidates);
      if (expiredUserIds.length === 0) return;

      this.logger.log(`Auto-ended ${expiredUserIds.length} driver shift(s)`);

      for (const userId of expiredUserIds) {
        this.events.emit('notification.created', {
          userId,
          title: 'Shift ended',
          body: 'Your shift has ended automatically. You are now off duty.',
          type: 'shift_auto_ended',
          tone: 'info',
          relatedEntity: 'shift',
          relatedEntityId: userId,
          skipInbox: true,
        });

        await this.redis.remove(userId, 'driver').catch((error) => {
          this.logger.warn(
            `Failed to remove driver ${userId} from Redis after shift expiry`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      }
    } catch (error) {
      this.logger.error('Driver expiry sweep failed', error);
    }
  }

  // ==================================================================
  // Public API — GET /shift, POST /shift/extend
  // ==================================================================

  async getShiftStatus(userId: string, role: Role): Promise<ShiftStatusDto> {
    if (role === Role.RESPONDER) {
      const row = await this.repo.findResponderShiftStatus(userId);
      if (!row) throw new NotFoundException('Responder profile not found');
      return this.buildStatus(
        'responder',
        row.availability === 'on_duty',
        row.shift_ends_at,
      );
    }
    if (role === Role.DRIVER) {
      const row = await this.repo.findDriverShiftStatus(userId);
      if (!row) throw new NotFoundException('Driver profile not found');
      return this.buildStatus(
        'driver',
        row.duty_status === 'on_duty',
        row.shift_ends_at,
      );
    }
    throw new ForbiddenException('Only drivers and responders have shifts');
  }

  async extendShift(
    userId: string,
    role: Role,
    minutes: number,
  ): Promise<ShiftStatusDto> {
    if (role === Role.RESPONDER) {
      const ok = await this.repo.extendResponderShift(userId, minutes);
      if (!ok) {
        throw new ConflictException(
          'You are not currently on duty with an active shift',
        );
      }
    } else if (role === Role.DRIVER) {
      const ok = await this.repo.extendDriverShift(userId, minutes);
      if (!ok) {
        throw new ConflictException(
          'You are not currently on duty with an active shift',
        );
      }
    } else {
      throw new ForbiddenException('Only drivers and responders have shifts');
    }
    return this.getShiftStatus(userId, role);
  }

  private buildStatus(
    role: 'driver' | 'responder',
    onDuty: boolean,
    shiftEndsAt: Date | null,
  ): ShiftStatusDto {
    return {
      role,
      on_duty: onDuty,
      shift_ends_at: shiftEndsAt ? shiftEndsAt.toISOString() : null,
      remaining_seconds: shiftEndsAt
        ? Math.max(0, Math.round((shiftEndsAt.getTime() - Date.now()) / 1000))
        : null,
    };
  }
}
