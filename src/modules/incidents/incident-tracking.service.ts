import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../database/database.service';
import { queryRows } from '../../common/utils/cursor-pagination-helper.util';
import { haversineDistance } from '../../common/utils/geo.utils';
import { RedisService } from '../redis/redis.service';
import { REDIS_CLIENT } from '../redis/provider/redis.provider';
import { IncidentStatus } from './enums/incident-status.enum';
import type { IncidentTrackingDto } from './interfaces/incident-track.interface';
import { IncidentEvents } from './events/incident-events';
import type {
  IncidentStatusChangedEvent,
  IncidentTrackingUpdatedEvent,
} from './events/incident-events';

/**
 * Mixed city traffic (≈30 km/h). Upgrade path: derive from the
 * responder's rolling average (v2) or OSRM (v3). See implementation
 * notes; not needed for the MVP.
 */
const AVG_SPEED_MPS = 8.33;

/** A fix older than this is not used for a "live" ETA. */
const STALE_FIX_MS = 90_000;

/**
 * The Redis hash `tracking:claimant` maps responderId → incidentId.
 * Populated on CLAIMED / EN_ROUTE, cleared on any other status. It
 * exists so `handleGpsUpdate` can answer "is this ping worth a
 * computeTracking call?" with one HGET instead of a Postgres query.
 */
const CLAIMANT_HASH = 'tracking:claimant';

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);
  private subscriber!: Redis;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    @Inject(REDIS_CLIENT) private readonly redisRaw: Redis,
    private readonly events: EventEmitter2,
  ) {}

  // =====================================================================
  // PUBLIC: snapshot
  // =====================================================================

  /**
   * Reads the incident, the claimant's live GPS, and returns a
   * ready-to-render tracking snapshot. Used by the polling endpoint
   * and by the real-time GPS ping handler.
   *
   * Returns null only when the incident row itself is missing.
   * Every other "missing" case (no claimant, no live GPS) is a
   * non-null DTO with null fields, so the client keeps the last
   * known values instead of blanking the UI.
   */
  async computeTracking(
    incidentId: string,
  ): Promise<IncidentTrackingDto | null> {
    const [row] = await queryRows<{
      id: string;
      lng: number;
      lat: number;
      claimed_by_id: string | null;
      status: IncidentStatus;
      f_name: string | null;
      l_name: string | null;
    }>(
      this.db,
      `SELECT i.id,
              ST_X(i.location::geometry) AS lng,
              ST_Y(i.location::geometry) AS lat,
              i.claimed_by_id,
              i.status,
              u.f_name,
              u.l_name
         FROM incident i
         LEFT JOIN user_account u ON u.id = i.claimed_by_id
        WHERE i.id = $1::uuid`,
      [incidentId],
    );
    if (!row) return null;

    const base: IncidentTrackingDto = {
      incident_id: row.id,
      status: row.status,
      responder_id: row.claimed_by_id,
      responder_name:
        row.f_name && row.l_name ? `${row.f_name} ${row.l_name}` : null,
      distance_meters: null,
      eta_seconds: null,
      last_seen_at: null,
      is_live: false,
      computed_at: new Date().toISOString(),
    };

    if (!row.claimed_by_id) return base;

    // Already there / done: ETA is 0, stop showing movement.
    if (
      row.status === IncidentStatus.ON_SCENE ||
      row.status === IncidentStatus.RESOLVED ||
      row.status === IncidentStatus.CANCELLED
    ) {
      return { ...base, distance_meters: 0, eta_seconds: 0 };
    }

    const fix = await this.redis.getFresh(row.claimed_by_id, STALE_FIX_MS);
    if (!fix) return base;

    const distance = haversineDistance(
      { latitude: row.lat, longitude: row.lng },
      { latitude: fix.latitude, longitude: fix.longitude },
    );

    return {
      ...base,
      distance_meters: Math.round(distance),
      eta_seconds: Math.max(0, Math.round(distance / AVG_SPEED_MPS)),
      last_seen_at: new Date(fix.updated_at).toISOString(),
      is_live: true,
    };
  }

  // =====================================================================
  // PUBLIC: claimant map (called by the STATUS_CHANGED listener)
  // =====================================================================

  private async registerClaimant(
    responderId: string,
    incidentId: string,
  ): Promise<void> {
    await this.redisRaw.hset(CLAIMANT_HASH, responderId, incidentId);
  }

  private async unregisterClaimant(responderId: string): Promise<void> {
    await this.redisRaw.hdel(CLAIMANT_HASH, responderId);
  }

  // =====================================================================
  // LIFECYCLE
  // =====================================================================

  async onModuleInit(): Promise<void> {
    // psubscribe puts a connection into subscriber mode; it can't run
    // normal commands afterwards, so we always use a duplicate. This
    // does NOT touch the shared REDIS_CLIENT used by RedisService.
    this.subscriber = this.redisRaw.duplicate();

    this.subscriber.on('error', (err) => {
      this.logger.error('Tracking subscriber error', err?.stack ?? String(err));
    });

    await this.subscriber.psubscribe('gps:updates:*');
    this.subscriber.on('pmessage', (_pattern, channel) => {
      void this.handleGpsUpdate(channel);
    });

    this.logger.log('Tracking subscriber started (pattern: gps:updates:*)');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.punsubscribe('gps:updates:*');
      } catch {
        /* ignore */
      }
      await this.subscriber.quit().catch(() => undefined);
    }
  }

  // =====================================================================
  // EVENT LISTENERS
  // =====================================================================

  /**
   * Mirror the incident's claim state into `tracking:claimant` so that
   * GPS pings can be filtered with one HGET.
   *
   *   CLAIMED / EN_ROUTE  →  register  (start tracking)
   *   anything else with a non-null claimant  →  unregister
   *   claimedById === null  →  no-op (see note below)
   *
   * The DISPATCHING transition (a stand-down) nulls claimed_by_id in
   * the DB (per incident_lifecycle_guard), so we can't unregister by
   * the caller's id — the map entry self-heals on the responder's
   * next GPS ping (`handleGpsUpdate` sees responder_id !== claimant
   * and deletes the stale entry).
   */
  @OnEvent(IncidentEvents.STATUS_CHANGED)
  async onStatusChanged(event: IncidentStatusChangedEvent): Promise<void> {
    if (!event.claimedById) return;

    const isActiveClaim =
      event.status === IncidentStatus.CLAIMED ||
      event.status === IncidentStatus.EN_ROUTE;

    if (isActiveClaim) {
      await this.registerClaimant(event.claimedById, event.incidentId);
    } else {
      await this.unregisterClaimant(event.claimedById);
    }
  }

  // =====================================================================
  // GPS PING HANDLER
  // =====================================================================

  private async handleGpsUpdate(channel: string): Promise<void> {
    const responderId = channel.slice('gps:updates:'.length);

    // Fast path: most pings are from responders who aren't claimants.
    const incidentId = await this.redisRaw.hget(CLAIMANT_HASH, responderId);
    if (!incidentId) return;

    let tracking: IncidentTrackingDto | null;
    try {
      tracking = await this.computeTracking(incidentId);
    } catch (error) {
      this.logger.error(
        `computeTracking failed for incident ${incidentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }
    if (!tracking) return;

    // Stale map entry (they stood down and someone else claimed):
    // self-heal by deleting this responder's mapping.
    if (tracking.responder_id !== responderId) {
      await this.redisRaw.hdel(CLAIMANT_HASH, responderId);
      return;
    }

    if (!tracking.is_live) return;

    const payload: IncidentTrackingUpdatedEvent = {
      incidentId: tracking.incident_id,
      responderId,
      responderName: tracking.responder_name,
      distanceMeters: tracking.distance_meters ?? 0,
      etaSeconds: tracking.eta_seconds ?? 0,
      lastSeenAt: tracking.last_seen_at ?? tracking.computed_at,
      computedAt: tracking.computed_at,
    };

    this.events.emit(IncidentEvents.TRACKING_UPDATED, payload);
  }
}
