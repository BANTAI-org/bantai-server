import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { GeoPoint } from '../../common/interfaces/geo-location.interface';
import { REDIS_CLIENT } from './provider/redis.provider';

export type TrackedRole = 'driver' | 'responder';

export interface LiveLocation {
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  /** Epoch ms on the SERVER clock. Never trust a client-supplied time. */
  updated_at: number;
}

export interface NearbyUser {
  user_id: string;
  distance_meters: number;
  location: LiveLocation;
}

/**
 * How long a fix lives with no new ping. A user who stops pinging (phone
 * dead, app killed, tunnel) disappears on their own after this.
 */
const LOCATION_TTL_SECONDS = 90;

const lastKey = (userId: string): string => `gps:last:${userId}`;
const geoKey = (role: TrackedRole): string => `gps:geo:${role}`;

/**
 * Live GPS for drivers and responders.
 *
 *   gps:last:{userId}  JSON of the latest fix, expires after 90s of silence
 *   gps:geo:{role}     GEO index (one per role) for radius searches
 *
 * The GEO index can't expire members by itself, so findNearby checks each
 * hit against its gps:last key and prunes the ones that have expired.
 * userId must always come from the verified JWT, never the request body.
 */
@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async update(
    userId: string,
    role: TrackedRole,
    { latitude, longitude }: GeoPoint,
    accuracyMeters: number | null = null,
  ): Promise<void> {
    const fix: LiveLocation = {
      latitude,
      longitude,
      accuracy_meters: accuracyMeters,
      updated_at: Date.now(),
    };

    const results = await this.redis
      .pipeline()
      .set(lastKey(userId), JSON.stringify(fix), 'EX', LOCATION_TTL_SECONDS)
      .geoadd(geoKey(role), longitude, latitude, userId)
      .exec();
    this.assertPipelineOk(results);
  }

  async get(userId: string): Promise<LiveLocation | null> {
    const raw = await this.redis.get(lastKey(userId));
    return raw === null ? null : parseFix(raw);
  }

  /**
   * Latest fix, but only if it is recent enough to act on (e.g. the
   * duty-toggle geofence check). Returns null when missing or stale.
   */
  async getFresh(
    userId: string,
    maxAgeMs = 30_000,
  ): Promise<LiveLocation | null> {
    const fix = await this.get(userId);
    if (!fix || Date.now() - fix.updated_at > maxAgeMs) return null;
    return fix;
  }

  /** Stop tracking (e.g. a responder going off duty, or logout). */
  async remove(userId: string, role: TrackedRole): Promise<void> {
    const results = await this.redis
      .pipeline()
      .del(lastKey(userId))
      .zrem(geoKey(role), userId)
      .exec();
    this.assertPipelineOk(results);
  }

  /** Nearest-first users of one role within radiusMeters of a point. */
  async findNearby(
    role: TrackedRole,
    center: GeoPoint,
    radiusMeters: number,
    { limit = 50, maxAgeMs = 60_000 } = {},
  ): Promise<NearbyUser[]> {
    // Over-fetch: some hits will be dropped as stale below.
    const raw: unknown = await this.redis.geosearch(
      geoKey(role),
      'FROMLONLAT',
      center.longitude,
      center.latitude,
      'BYRADIUS',
      radiusMeters,
      'm',
      'ASC',
      'COUNT',
      limit * 2,
      'WITHDIST',
    );

    const hits = Array.isArray(raw) ? raw.filter(isHit) : [];
    if (hits.length === 0) return [];

    const fixes = await this.redis.mget(hits.map(([id]) => lastKey(id)));

    const result: NearbyUser[] = [];
    const expired: string[] = [];
    hits.forEach(([userId, distance], index) => {
      const raw = fixes[index];
      if (raw === null || raw === undefined) {
        expired.push(userId);
        return;
      }
      const fix = parseFix(raw);
      if (!fix || Date.now() - fix.updated_at > maxAgeMs) return;
      result.push({
        user_id: userId,
        distance_meters: Number(distance),
        location: fix,
      });
    });

    if (expired.length > 0) {
      // Lazy cleanup; a failure here must not fail the search.
      await this.redis.zrem(geoKey(role), ...expired).catch(() => 0);
    }
    return result.slice(0, limit);
  }

  private assertPipelineOk(results: [Error | null, unknown][] | null): void {
    if (results === null) throw new Error('Redis pipeline was discarded');
    for (const [error] of results) {
      if (error) throw error;
    }
  }
}

function isHit(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'string' &&
    (typeof value[1] === 'string' || typeof value[1] === 'number')
  );
}

function parseFix(raw: string): LiveLocation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { latitude, longitude, accuracy_meters, updated_at } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    typeof updated_at !== 'number'
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    accuracy_meters:
      typeof accuracy_meters === 'number' ? accuracy_meters : null,
    updated_at,
  };
}
