import { Injectable } from '@nestjs/common';
import { RedisService, NearbyUser } from '../redis/redis.service';
import { DatabaseService } from '../../database/database.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  type IncidentCreatedEvent,
  IncidentEvents,
} from './events/incident-events';
import { isPeerHelpEligible } from './utils/peer-help-policy.util';

// Import the enums needed to build the eligibility check
import { IncidentSeverity } from './enums/incident-severity.enum';
import { ThreatCategory } from './enums/threat-category.enum';
import { ThreatLevel } from './enums/threat-level.enum';

@Injectable()
export class PeerDispatchService {
  constructor(
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(IncidentEvents.CREATED)
  async dispatchPeers(event: IncidentCreatedEvent) {
    const isEligible = isPeerHelpEligible({
      threat_type: event.threatType,
      threat_category: event.threatCategory,
      severity: event.severity ?? IncidentSeverity.UNKNOWN,
      threat_level:
        event.threatCategory === ThreatCategory.ASSIST
          ? ThreatLevel.CLEAR
          : ThreatLevel.ACTIVE_THREAT,
    });

    if (!isEligible) return;

    const nearbyDrivers = await this.redis.findNearby(
      'driver',
      event.location,
      3000,
      { limit: 50 },
    );

    if (nearbyDrivers.length === 0) return;

    await this.savePeerResponses(event.incidentId, nearbyDrivers);

    this.events.emit('peer.notified', {
      incidentId: event.incidentId,
      nearbyDrivers: nearbyDrivers,
    });
  }

  private async savePeerResponses(
    incidentId: string,
    nearbyDrivers: NearbyUser[],
  ): Promise<void> {
    const driverIds = nearbyDrivers.map((d) => d.user_id);
    const distances = nearbyDrivers.map((d) => d.distance_meters);

    await this.db.query(
      `INSERT INTO incident_peer_response (
         incident_id, 
         peer_driver_id, 
         status, 
         distance_meters
       )
       SELECT $1, 
              unnest($2::uuid[]), 
              'notified'::peer_response_status, 
              unnest($3::numeric[])
       ON CONFLICT (incident_id, peer_driver_id) DO NOTHING`,
      [incidentId, driverIds, distances],
    );
  }
}
