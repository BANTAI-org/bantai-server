import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IncidentRepository } from './incidents.repository';
import { IncidentService } from './incidents.service';
import { EscalationReason } from './enums/escalation-reason.enum';

@Injectable()
export class SlaSweeperService {
  private readonly logger = new Logger(SlaSweeperService.name);

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly incidentService: IncidentService,
  ) {}

  /**
   * Runs every 30 seconds.
   * Finds incidents stuck in DISPATCHING for > 90 seconds (meaning the server
   * probably restarted, losing the setTimeout) and escalates them.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron() {
    try {
      // We need a way to find orphaned incidents.
      // We will add a method to the repository for this.
      const orphanedIds =
        await this.incidentRepository.findOrphanedIncidents(90);

      if (orphanedIds.length === 0) return;

      this.logger.warn(
        `Found ${orphanedIds.length} orphaned incidents. Triggering SLA escalation...`,
      );

      const ccId = await this.incidentRepository.findFirstCommandCenterId();
      if (!ccId) return;

      for (const id of orphanedIds) {
        await this.incidentService.escalateIncident(
          id,
          ccId,
          EscalationReason.SLA_TIMEOUT,
          null,
          'Auto-escalated by safety sweeper (Server Restart Recovery).',
        );
      }
    } catch (error) {
      this.logger.error('SLA sweeper failed', error);
    }
  }
}
