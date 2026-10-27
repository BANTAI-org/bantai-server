import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { IncidentRepository } from '../incidents/incidents.repository';
import { RedisService } from '../redis/redis.service';
import { IncidentEvents } from '../incidents/events/incident-events';
import type { IncidentCreatedEvent } from '../incidents/events/incident-events';
import type { IncidentEntity } from '../incidents/interfaces/incident-entity.interface';

@Injectable()
export class WaveDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaveDispatchService.name);

  private activeTimers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly redisService: RedisService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const orphans = await this.incidentRepository.findDispatchingIncidents();
      if (orphans.length === 0) {
        this.logger.log('Wave engine: no orphaned incidents to recover');
        return;
      }
      this.logger.warn(
        `Wave engine: recovering ${orphans.length} orphaned DISPATCHING incidents`,
      );
      for (const incident of orphans) {
        this.recoverIncident(incident);
      }
    } catch (error) {
      this.logger.error(
        'Wave engine: recovery failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private recoverIncident(incident: IncidentEntity): void {
    const ageMs = Date.now() - new Date(incident.created_at).getTime();
    const event = this.toCreatedEvent(incident);

    const remaining = (targetMs: number): number =>
      Math.max(0, targetMs - ageMs);

    const timers: NodeJS.Timeout[] = [];

    timers.push(
      setTimeout(
        () => void this.checkAndFireNextWave(event, 2, 2000),
        remaining(20_000),
      ),
    );

    timers.push(
      setTimeout(
        () => void this.checkAndFireNextWave(event, 3, 3000),
        remaining(40_000),
      ),
    );

    timers.push(
      setTimeout(
        () => void this.triggerSlaEscalation(event),
        remaining(60_000),
      ),
    );

    this.activeTimers.set(incident.id, timers);
    this.logger.log(
      `Recovered incident ${incident.id} (age ${Math.round(ageMs / 1000)}s)`,
    );
  }

  private toCreatedEvent(incident: IncidentEntity): IncidentCreatedEvent {
    return {
      incidentId: incident.id,
      triggerSource: incident.trigger_source,
      threatType: incident.threat_type,
      threatCategory: incident.threat_category,
      severity: incident.severity,
      location: incident.location,
      driverId: incident.driver_id,
    };
  }

  @OnEvent(IncidentEvents.CREATED)
  async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
    this.logger.log(`Starting wave sequence for incident ${event.incidentId}`);
    await this.issueWave(event, 1, 1000);
    this.armTimers(event);
  }

  @OnEvent(IncidentEvents.STATUS_CHANGED)
  async handleStatusChanged(event: {
    incidentId: string;
    status: string;
  }): Promise<void> {
    const stopStatuses = ['CLAIMED', 'RESOLVED', 'CANCELLED', 'ESCALATED'];
    if (stopStatuses.includes(event.status)) {
      const timers = this.activeTimers.get(event.incidentId);
      if (timers) {
        timers.forEach((timer) => clearTimeout(timer));
        this.activeTimers.delete(event.incidentId);
        this.logger.log(
          `Cleared pending waves for incident ${event.incidentId} (Status: ${event.status})`,
        );
      }
      return;
    }

    // Re-arm when the incident returns to DISPATCHING (stand-down path).
    if (event.status === 'DISPATCHING') {
      if (this.activeTimers.has(event.incidentId)) return;
      try {
        const incident = await this.incidentRepository.findIncidentById(
          event.incidentId,
        );
        if (!incident) return;
        this.logger.log(
          `Re-arming waves for incident ${event.incidentId} (back to DISPATCHING)`,
        );
        this.recoverIncident(incident);
      } catch (error) {
        this.logger.error(
          `Failed to re-arm waves for ${event.incidentId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private armTimers(event: IncidentCreatedEvent): void {
    const timer2 = setTimeout(() => {
      void this.checkAndFireNextWave(event, 2, 2000);
    }, 20_000);

    const timer3 = setTimeout(() => {
      void this.checkAndFireNextWave(event, 3, 3000);
    }, 40_000);

    const timerEscalate = setTimeout(() => {
      void this.triggerSlaEscalation(event);
    }, 60_000);

    this.activeTimers.set(event.incidentId, [timer2, timer3, timerEscalate]);
  }

  private async checkAndFireNextWave(
    event: IncidentCreatedEvent,
    waveNumber: number,
    radiusMeters: number,
  ): Promise<void> {
    try {
      const isUnclaimed = await this.incidentRepository.isIncidentUnclaimed(
        event.incidentId,
      );

      if (isUnclaimed) {
        await this.issueWave(event, waveNumber, radiusMeters);
      } else {
        this.logger.log(
          `Incident ${event.incidentId} was claimed or closed. Skipping Wave #${waveNumber}.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check wave status for ${event.incidentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async triggerSlaEscalation(
    event: IncidentCreatedEvent,
  ): Promise<void> {
    try {
      const isUnclaimed = await this.incidentRepository.isIncidentUnclaimed(
        event.incidentId,
      );

      if (isUnclaimed) {
        this.logger.warn(
          `Incident ${event.incidentId} hit SLA timeout. Escalating to Command Center.`,
        );
        this.events.emit('incident.sla_timeout', {
          incidentId: event.incidentId,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed SLA check for ${event.incidentId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async issueWave(
    event: IncidentCreatedEvent,
    waveNumber: number,
    radiusMeters: number,
  ): Promise<void> {
    try {
      this.logger.log(
        `Issuing Wave #${waveNumber} (${radiusMeters}m) for incident ${event.incidentId}`,
      );

      const nearbyResponders = await this.redisService.findNearby(
        'responder',
        event.location,
        radiusMeters,
        { maxAgeMs: 30_000 },
      );

      if (nearbyResponders.length === 0) {
        this.logger.debug(
          `No responders found within ${radiusMeters}m for Wave #${waveNumber}`,
        );
        return;
      }

      const activeIds = await this.incidentRepository.filterOnDutyResponders(
        nearbyResponders.map((r) => r.user_id),
      );

      const verifiedResponders = nearbyResponders.filter((r) =>
        activeIds.includes(r.user_id),
      );

      if (verifiedResponders.length === 0) {
        this.logger.debug(
          `All nearby responders for Wave #${waveNumber} are off-duty or inactive.`,
        );
        return;
      }

      const waveId = await this.incidentRepository.createDispatchWave(
        event.incidentId,
        radiusMeters,
      );

      // Insert assignments. The repo returns ONLY the newly inserted IDs.
      const insertedResponderIds =
        await this.incidentRepository.createWaveAssignments(
          event.incidentId,
          waveId,
          verifiedResponders.map((r) => ({
            user_id: r.user_id,
            distance_meters: r.distance_meters,
          })),
        );

      // Filter to only the NEW ones — skip anyone already offered in a prior wave.
      const newlyOfferedResponders = verifiedResponders.filter((r) =>
        insertedResponderIds.includes(r.user_id),
      );

      if (newlyOfferedResponders.length === 0) {
        this.logger.log(
          `Wave #${waveNumber} had 0 new responders (all already offered in a prior wave). Skipping emit.`,
        );
        return;
      }

      this.events.emit('wave.issued', {
        incidentId: event.incidentId,
        waveId,
        waveNumber,
        responders: newlyOfferedResponders,
      });

      for (const responder of newlyOfferedResponders) {
        this.events.emit('notification.created', {
          userId: responder.user_id,
          title: 'New Emergency Assignment',
          body: `Incident ${Math.round(responder.distance_meters)}m away — Wave #${waveNumber}`,
          type: 'dispatch_assigned',
          relatedEntityId: event.incidentId,
        });
      }

      this.logger.log(
        `Wave #${waveNumber} issued to ${newlyOfferedResponders.length} new responders (skipped ${verifiedResponders.length - newlyOfferedResponders.length} already offered)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to issue Wave #${waveNumber}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  onModuleDestroy(): void {
    for (const timers of this.activeTimers.values()) {
      timers.forEach((timer) => clearTimeout(timer));
    }
    this.activeTimers.clear();
  }
}
