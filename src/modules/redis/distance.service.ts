import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../database/database.service';
import { REDIS_CLIENT } from './provider/redis.provider';
import { GeoPoint } from '../../common/interfaces/geo-location.interface';
import { haversineDistance } from '../../common/utils/geo.utils';

const SESSION_TTL_SECONDS = 18 * 3600;
const MIN_MOVEMENT_METERS = 5;
const MAX_JUMP_METERS = 500;

export interface DistanceSnapshotSession {
  distance_meters: number;
  started_at: string;
}

export interface DistanceSnapshotLastShift {
  distance_meters: number;
  started_at: string;
  ended_at: string;
}

export interface DistanceSnapshot {
  duty_status: 'on_duty' | 'off_duty';
  session: DistanceSnapshotSession | null;
  last_shift: DistanceSnapshotLastShift | null;
}

@Injectable()
export class DistanceService {
  private readonly logger = new Logger(DistanceService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly db: DatabaseService,
  ) {}

  private distKey(userId: string): string {
    return `gps:session_distance:${userId}`;
  }
  private startKey(userId: string): string {
    return `gps:session_started_at:${userId}`;
  }
  private dutyKey(userId: string): string {
    return `gps:duty:${userId}`;
  }
  private lastFixKey(userId: string): string {
    return `gps:last:${userId}`;
  }

  async startSession(userId: string): Promise<void> {
    const exists = await this.redis.exists(this.dutyKey(userId));
    if (exists) return;

    await this.redis
      .multi()
      .set(this.distKey(userId), '0', 'EX', SESSION_TTL_SECONDS)
      .set(this.startKey(userId), String(Date.now()), 'EX', SESSION_TTL_SECONDS)
      .set(this.dutyKey(userId), '1', 'EX', SESSION_TTL_SECONDS)
      .exec();
  }

  async endSession(userId: string): Promise<void> {
    const [distRaw, startRaw] = await this.redis.mget(
      this.distKey(userId),
      this.startKey(userId),
    );

    if (distRaw !== null && startRaw !== null) {
      const finalDistance = parseInt(distRaw, 10);
      const startedAt = new Date(parseInt(startRaw, 10));

      await this.db.query(
        `INSERT INTO driver_shift_log (driver_id, started_at, ended_at, distance_meters)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (driver_id, started_at) DO NOTHING`,
        [userId, startedAt, finalDistance],
      );
    }

    await this.redis
      .multi()
      .del(this.distKey(userId))
      .del(this.startKey(userId))
      .del(this.dutyKey(userId))
      .exec();
  }

  async accumulate(userId: string, fix: GeoPoint): Promise<void> {
    const onDuty = await this.redis.get(this.dutyKey(userId));
    if (!onDuty) return;

    const prevRaw = await this.redis.get(this.lastFixKey(userId));
    if (!prevRaw) return;

    let prev: GeoPoint;
    try {
      const parsed = JSON.parse(prevRaw) as Record<string, unknown>;
      if (
        typeof parsed.latitude !== 'number' ||
        typeof parsed.longitude !== 'number'
      ) {
        return;
      }
      prev = { latitude: parsed.latitude, longitude: parsed.longitude };
    } catch {
      return;
    }

    const delta = haversineDistance(prev, fix);
    if (delta < MIN_MOVEMENT_METERS) return;
    if (delta > MAX_JUMP_METERS) return;

    await this.redis.incrby(this.distKey(userId), Math.round(delta));
  }

  async getSnapshot(userId: string): Promise<DistanceSnapshot> {
    const [profileRes, sessionRes, lastLogRes] = await Promise.all([
      this.db.query<{ duty_status: string }>(
        `SELECT duty_status FROM d_profile WHERE user_id = $1`,
        [userId],
      ),
      this.redis.mget(this.distKey(userId), this.startKey(userId)),
      this.db.query<{
        started_at: Date;
        ended_at: Date;
        distance_meters: string;
      }>(
        `SELECT started_at, ended_at, distance_meters
           FROM driver_shift_log
          WHERE driver_id = $1
          ORDER BY ended_at DESC
          LIMIT 1`,
        [userId],
      ),
    ]);

    const dutyStatus = (profileRes.rows[0]?.duty_status ?? 'off_duty') as
      'on_duty' | 'off_duty';
    const [distRaw, startRaw] = sessionRes;

    let session: DistanceSnapshotSession | null = null;

    if (dutyStatus === 'on_duty' && distRaw !== null && startRaw !== null) {
      session = {
        distance_meters: parseInt(distRaw, 10),
        started_at: new Date(parseInt(startRaw, 10)).toISOString(),
      };
    } else if (dutyStatus === 'on_duty') {
      this.logger.warn(`Self-healing missing Redis session for ${userId}`);
      await this.startSession(userId);
      const [distNow, startNow] = await this.redis.mget(
        this.distKey(userId),
        this.startKey(userId),
      );
      if (distNow !== null && startNow !== null) {
        session = {
          distance_meters: parseInt(distNow, 10),
          started_at: new Date(parseInt(startNow, 10)).toISOString(),
        };
      }
    }

    const last = lastLogRes.rows[0];
    const lastShift: DistanceSnapshotLastShift | null = last
      ? {
          distance_meters: parseFloat(last.distance_meters),
          started_at: last.started_at.toISOString(),
          ended_at: last.ended_at.toISOString(),
        }
      : null;

    return { duty_status: dutyStatus, session, last_shift: lastShift };
  }
}
