import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RedisService, NearbyUser } from '../redis/redis.service';
import { DatabaseService } from '../../database/database.service';
import { IncidentRepository } from './incidents.repository';
import {
  type IncidentCreatedEvent,
  IncidentEvents,
} from './events/incident-events';
import { isPeerHelpEligible } from './utils/peer-help-policy.util';
import { IncidentSeverity } from './enums/incident-severity.enum';
import { ThreatCategory } from './enums/threat-category.enum';
import { ThreatLevel } from './enums/threat-level.enum';

/**
 * Autonomous Peer Dispatch Engine.
 *
 * When an incident is created that is safe for riders to attend (ASSIST + MINOR
 * + CLEAR), this service notifies nearby on-duty peer drivers so they can
 * offer help before official responders arrive.
 *
 * Runs immediately on incident creation — no escalation, no timers. Peers
 * receive a single notification; the incident wave engine handles responders.
 */
@Injectable()
export class PeerDispatchService {
  private readonly logger = new Logger(PeerDispatchService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
    private readonly incidentRepository: IncidentRepository,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Fires immediately when an incident is created.
   * Only notifies peers if the incident is safe for them to attend.
   */
  @OnEvent(IncidentEvents.CREATED)
  async dispatchPeers(event: IncidentCreatedEvent): Promise<void> {
    try {
      // 1. Eligibility gate — only ASSIST + MINOR + CLEAR incidents are peer-eligible.
      const isEligible = isPeerHelpEligible({
        threat_type: event.threatType,
        threat_category: event.threatCategory,
        severity: event.severity ?? IncidentSeverity.UNKNOWN,
        threat_level:
          event.threatCategory === ThreatCategory.ASSIST
            ? ThreatLevel.CLEAR
            : ThreatLevel.ACTIVE_THREAT,
      });

      if (!isEligible) {
        this.logger.debug(
          `Incident ${event.incidentId} is not peer-eligible. Skipping peer dispatch.`,
        );
        return;
      }

      // 2. Spatial search — find nearby drivers within 3 km.
      const nearbyDrivers = await this.redis.findNearby(
        'driver',
        event.location,
        3000,
        { limit: 50 },
      );

      if (nearbyDrivers.length === 0) {
        this.logger.debug(
          `No nearby drivers found for incident ${event.incidentId}`,
        );
        return;
      }

      // 3. Verify against Postgres — only keep drivers who are actually
      //    `on_duty` with an active, non-deleted account.
      const activeIds = await this.incidentRepository.filterOnDutyDrivers(
        nearbyDrivers.map((d) => d.user_id),
      );

      const verifiedDrivers = nearbyDrivers.filter((d) =>
        activeIds.includes(d.user_id),
      );

      if (verifiedDrivers.length === 0) {
        this.logger.debug(
          `All nearby drivers for incident ${event.incidentId} are off-duty or inactive.`,
        );
        return;
      }

      // 4. Persist the peer notifications (status = 'notified')
      await this.savePeerResponses(event.incidentId, verifiedDrivers);

      // 5. Broadcast to the gateway → individual socket rooms
      this.events.emit('peer.notified', {
        incidentId: event.incidentId,
        nearbyDrivers: verifiedDrivers,
      });

      this.logger.log(
        `Peer dispatch: notified ${verifiedDrivers.length} verified drivers for incident ${event.incidentId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed peer dispatch for incident ${event.incidentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Bulk inserts peer response records using UNNEST for a single round-trip.
   * ON CONFLICT prevents duplicate rows if the same incident is re-dispatched.
   */
  private async savePeerResponses(
    incidentId: string,
    nearbyDrivers: NearbyUser[],
  ): Promise<void> {
    if (nearbyDrivers.length === 0) return;

    const driverIds = nearbyDrivers.map((d) => d.user_id);
    const distances = nearbyDrivers.map((d) => d.distance_meters);

    await this.db.query(
      `INSERT INTO incident_peer_response (
         incident_id,
         peer_driver_id,
         status,
         distance_meters
       )
       SELECT $1::uuid,
              unnest($2::uuid[]),
              'notified'::peer_response_status,
              unnest($3::numeric[])
       ON CONFLICT (incident_id, peer_driver_id) DO NOTHING`,
      [incidentId, driverIds, distances],
    );
  }
}
