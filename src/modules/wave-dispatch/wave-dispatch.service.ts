import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { IncidentRepository } from '../incidents/incidents.repository';
import { RedisService } from '../redis/redis.service';
import { IncidentEvents } from '../incidents/events/incident-events';
import type { IncidentCreatedEvent } from '../incidents/events/incident-events';

/**
 * Autonomous Wave Dispatch Engine.
 *
 * When an incident is created, this service fires a sequence of radial waves:
 *   - Wave 1 (0s,   1km)
 *   - Wave 2 (20s,  2km)
 *   - Wave 3 (40s,  3km)
 *   - SLA Timeout (60s) → escalate to Command Center
 *
 * Timers are tracked per-incident and cancelled immediately when the incident
 * is claimed, resolved, cancelled, or escalated. Every wave verifies its
 * candidates against Postgres to ensure they are genuinely on-duty.
 */
@Injectable()
export class WaveDispatchService implements OnModuleDestroy {
  private readonly logger = new Logger(WaveDispatchService.name);

  /**
   * Tracks the timers for each active incident so they can be cancelled
   * when the incident is claimed (or otherwise reaches a terminal state).
   */
  private activeTimers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly redisService: RedisService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Fires the wave sequence when an incident is created.
   */
  @OnEvent(IncidentEvents.CREATED)
  async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
    this.logger.log(`Starting wave sequence for incident ${event.incidentId}`);

    // Wave 1: Immediate (1km)
    await this.issueWave(event, 1, 1000);

    // Wave 2: After 20 seconds (2km)
    const timer2 = setTimeout(() => {
      void this.checkAndFireNextWave(event, 2, 2000);
    }, 20_000);

    // Wave 3: After 40 seconds (3km)
    const timer3 = setTimeout(() => {
      void this.checkAndFireNextWave(event, 3, 3000);
    }, 40_000);

    // SLA Timeout: After 60 seconds, escalate to Command Center
    const timerEscalate = setTimeout(() => {
      void this.triggerSlaEscalation(event);
    }, 60_000);

    this.activeTimers.set(event.incidentId, [timer2, timer3, timerEscalate]);
  }

  /**
   * Before firing the next wave, check whether the incident is still unclaimed.
   */
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

  /**
   * After 60 seconds with no claimant, escalate to a Command Center.
   */
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

  /**
   * Core wave-issuance logic:
   *   1. Find candidates in Redis (spatial search).
   *   2. VERIFY each candidate is genuinely `on_duty` in Postgres.
   *   3. Persist the wave + assignments for verified responders only.
   *   4. Emit `wave.issued` so the gateway can notify them.
   */
  private async issueWave(
    event: IncidentCreatedEvent,
    waveNumber: number,
    radiusMeters: number,
  ): Promise<void> {
    try {
      this.logger.log(
        `Issuing Wave #${waveNumber} (${radiusMeters}m) for incident ${event.incidentId}`,
      );

      // 1. Find nearby candidates in Redis
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

      // 2. Verify against Postgres — only keep responders who are
      //    actually `on_duty` with an active, non-deleted account.
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

      // 3. Create the wave + assignments in Postgres
      const waveId = await this.incidentRepository.createDispatchWave(
        event.incidentId,
        radiusMeters,
      );

      await this.incidentRepository.createWaveAssignments(
        event.incidentId,
        waveId,
        verifiedResponders.map((r) => ({
          user_id: r.user_id,
          distance_meters: r.distance_meters,
        })),
      );

      // 4. Notify the verified responders via WebSocket
      this.events.emit('wave.issued', {
        incidentId: event.incidentId,
        waveId,
        waveNumber,
        responders: verifiedResponders,
      });

      this.logger.log(
        `Wave #${waveNumber} issued to ${verifiedResponders.length} verified responders`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to issue Wave #${waveNumber}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Cancels pending waves the moment an incident is claimed, resolved,
   * cancelled, or escalated. Prevents ghost offers after the incident has moved on.
   */
  @OnEvent(IncidentEvents.STATUS_CHANGED)
  handleStatusChanged(event: { incidentId: string; status: string }): void {
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
    }
  }

  /**
   * Cleans up any remaining timers on shutdown (Railway redeploy, etc.).
   */
  onModuleDestroy(): void {
    for (const timers of this.activeTimers.values()) {
      timers.forEach((timer) => clearTimeout(timer));
    }
    this.activeTimers.clear();
  }
}
