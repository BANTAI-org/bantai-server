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

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron() {
    await this.sweepDispatching();
    await this.sweepStalledClaims();
  }

  private async sweepDispatching(): Promise<void> {
    try {
      const orphanedIds =
        await this.incidentRepository.findOrphanedIncidents(90);
      if (orphanedIds.length === 0) return;

      this.logger.warn(
        `Found ${orphanedIds.length} orphaned incidents. Escalating...`,
      );

      const ccId = await this.incidentRepository.findFirstCommandCenterId();
      if (!ccId) return;

      for (const id of orphanedIds) {
        try {
          await this.incidentService.escalateIncident(
            id,
            ccId,
            EscalationReason.SLA_TIMEOUT,
            null,
            'Auto-escalated by safety sweeper (Server Restart Recovery).',
          );
        } catch (error) {
          this.logger.error(
            `Failed to escalate orphaned incident ${id}`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Dispatching sweep failed', error);
    }
  }

  private async sweepStalledClaims(): Promise<void> {
    try {
      // 600 seconds = 10 minutes. Was 120.
      const stalledIds = await this.incidentRepository.findStalledClaims(600);
      if (stalledIds.length === 0) return;

      this.logger.warn(
        `Found ${stalledIds.length} stalled claims. Escalating...`,
      );

      const ccId = await this.incidentRepository.findFirstCommandCenterId();
      if (!ccId) return;

      for (const id of stalledIds) {
        try {
          await this.incidentService.escalateIncident(
            id,
            ccId,
            EscalationReason.SLA_TIMEOUT,
            null,
            'Auto-escalated by safety sweeper (Claimant did not reach scene).',
          );
        } catch (error) {
          this.logger.error(`Failed to escalate stalled incident ${id}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Stalled claims sweep failed', error);
    }
  }
}
