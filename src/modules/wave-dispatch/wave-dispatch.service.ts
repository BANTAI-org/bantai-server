import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IncidentRepository } from '../incidents/incidents.repository';
import { RedisService } from '../redis/redis.service';
import { IncidentEvents } from '../incidents/events/incident-events';
import { GeoPoint } from '../../common/interfaces/geo-location.interface';
import { AssignmentOrigin } from '../incidents/enums/assignment-origin.enum';

/**
 * Wave dispatch service responsible for finding nearby responders and peers
 * when an incident is created and issuing wave offers to them.
 */
@Injectable()
export class WaveDispatchService {
  private readonly logger = new Logger(WaveDispatchService.name);

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Default wave radius in meters for different incident types.
   * Can be adjusted based on incident severity/threat level.
   */
  private readonly DEFAULT_WAVE_RADIUS_METERS = 1000; // 1km

  /**
   * Get wave radius based on incident characteristics.
   * More severe incidents get larger wave radius.
   */
  private getWaveRadius(
    threatCategory: string,
    threatLevel: string,
    severity: string | null,
  ): number {
    // Base radius
    let radius = this.DEFAULT_WAVE_RADIUS_METERS;

    // Adjust based on threat level
    if (threatLevel === 'ACTIVE_THREAT') {
      radius = Math.max(radius, 2000); // At least 2km for active threats
    } else if (threatLevel === 'CLEAR') {
      radius = Math.min(radius, 1000); // At most 1km for clear scenes
    }

    // Adjust based on threat category
    if (threatCategory === 'HAZARD') {
      radius = Math.max(radius, 3000); // Up to 3km for hazards
    } else if (threatCategory === 'ASSIST') {
      radius = Math.min(radius, 2000); // At most 2km for assists
    }

    // Adjust based on severity if provided
    if (severity) {
      if (severity === 'CRITICAL') {
        radius = Math.max(radius, 3000);
      } else if (severity === 'SERIOUS') {
        radius = Math.max(radius, 2000);
      } else if (severity === 'MINOR') {
        radius = Math.min(radius, 1000);
      }
    }

    // Ensure radius is within reasonable bounds (1km - 3km)
    return Math.min(Math.max(radius, 1000), 3000);
  }

  /**
   * Handle incident creation by issuing a wave offer to nearby responders.
   * @param event The incident created event
   */
  @OnEvent(IncidentEvents.CREATED)
  async handleIncidentCreated(event: {
    incidentId: string;
    location: GeoPoint;
    threatCategory: string;
    threatLevel: string;
    severity: string | null;
  }): Promise<void> {
    try {
      this.logger.log(
        `Processing wave dispatch for incident ${event.incidentId}`,
      );

      // Determine wave radius based on incident characteristics
      const waveRadiusMeters = this.getWaveRadius(
        event.threatCategory,
        event.threatLevel,
        event.severity,
      );

      this.logger.log(
        `Issuing wave ${waveRadiusMeters}m radius for incident ${event.incidentId}`,
      );

      // Find nearby on-duty responders
      const nearbyResponders = await this.redisService.findNearby(
        'responder',
        event.location,
        waveRadiusMeters,
        { maxAgeMs: 30000 }, // Only responders active in last 30s
      );

      this.logger.log(
        `Found ${nearbyResponders.length} nearby responders for incident ${event.incidentId}`,
      );

      if (nearbyResponders.length === 0) {
        this.logger.log(
          `No nearby responders found for incident ${event.incidentId}`,
        );
        return;
      }

      // Create wave record
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      const waveResult = await (this.incidentRepository as any).db.queryRows(
        `
          INSERT INTO incident_dispatch_wave (
            incident_id,
            wave_number,
            radius_meters
          )
          SELECT
            $1,
            COALESCE((SELECT MAX(wave_number) + 1 FROM incident_dispatch_wave WHERE incident_id = $1), 1),
            $2
          RETURNING id
        `,
        [event.incidentId, waveRadiusMeters],
      );

      const waveId =
        Array.isArray(waveResult) && waveResult.length > 0
          ? ((waveResult[0] as { id: string | null }).id ?? null)
          : null;
      if (!waveId) {
        throw new Error('Failed to create wave record');
      }

      this.logger.log(
        `Created wave ${waveId} (wave #${await this.getWaveNumber(event.incidentId)}) for incident ${event.incidentId}`,
      );

      // Create assignment records for each nearby responder
      const assignmentPromises = nearbyResponders.map(async (responder) => {
        // Validate responder has required properties
        if (
          responder &&
          typeof responder === 'object' &&
          'user_id' in responder &&
          'distance_meters' in responder
        ) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
          await (this.incidentRepository as any).db.query(
            `
              INSERT INTO incident_responder_assignment (
                incident_id,
                wave_id,
                responder_id,
                origin,
                distance_meters,
                status
              )
              VALUES (
                $1, $2, $3, $4, $5, 'OFFERED'
              )
            `,
            [
              event.incidentId,
              waveId,
              (responder as { user_id: string; distance_meters: number })
                .user_id,
              AssignmentOrigin.WAVE_OFFER,
              (responder as { user_id: string; distance_meters: number })
                .distance_meters,
            ],
          );
        }
      });

      await Promise.all(assignmentPromises);

      this.logger.log(
        `Created ${nearbyResponders.length} assignment records for wave ${waveId}`,
      );

      // TODO: Notify responders via WebSocket/gateway
      // This would typically involve publishing to a Redis channel or
      // using the IncidentGateway to send notifications
    } catch (error) {
      this.logger.error(
        `Failed to process wave dispatch for incident ${event.incidentId}:`,
        error,
      );
      // Don't throw - we don't want wave dispatch failures to affect incident creation
    }
  }

  /**
   * Get the next wave number for an incident (helper for logging).
   * @private
   */
  private async getWaveNumber(incidentId: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
    const result = await (this.incidentRepository as any).db.queryRows(
      `
        SELECT COALESCE(MAX(wave_number), 0) + 1 as wave_number
        FROM incident_dispatch_wave
        WHERE incident_id = $1
      `,
      [incidentId],
    );
    return Array.isArray(result) && result.length > 0
      ? ((result[0] as { wave_number: number | null }).wave_number ?? 1)
      : 1;
  }
}
