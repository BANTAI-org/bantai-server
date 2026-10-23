import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { CreateIncidentReportDto } from './dto/create-incident-report.dto';
import { FindReportsAwaitingReviewQueryDto } from './dto/find-reports-awaiting-review.dto';
import { UpdateReportDraftDto } from './dto/report-draft.dto';
import { toIncidentEvidenceItems } from './utils/convert-to-incident-evidence-item.util';
import { ArrivalConfirmationMethod } from './enums/arrival-confirmation-method.enum';
import { EscalationReason } from './enums/escalation-reason.enum';
import { IncidentDisposition } from './enums/incident-disposition.enum';
import { IncidentOutcome } from './enums/incident-outcome.enum';
import { IncidentSeverity } from './enums/incident-severity.enum';
import { IncidentStatus } from './enums/incident-status.enum';
import { PeerResponseStatus } from './enums/peer-response-status.enum';
import { ThreatCategory } from './enums/threat-category.enum';
import { ThreatLevel } from './enums/threat-level.enum';
import { ThreatType } from './enums/threat-type.enum';
import { TriggerSource } from './enums/trigger-source.enum';

import {
  IncidentCreatedEvent,
  IncidentEscalatedEvent,
  IncidentEvents,
  IncidentPeerRespondedEvent,
  IncidentPeerStandDownEvent,
  IncidentSeverityChangedEvent,
  IncidentStatusChangedEvent,
  IncidentThreatLevelChangedEvent,
  IncidentVerifiedEvent,
  PeerStandDownReason,
  ReportEvents,
  ReportStatusChangedEvent,
} from './events/incident-events';
import { IncidentEntity } from './interfaces/incident-entity.interface';
import { IncidentLogEntity } from './interfaces/incident-log-entity.interface';
import { IncidentReportEntity } from './interfaces/incident-report-entity.interface';
import {
  isPeerHelpEligible,
  isPhysicalPeerResponse,
} from './utils/peer-help-policy.util';
import { IncidentRepository } from './incidents.repository';
import { IncidentReportRepository } from './incidents-report.repository';
import { ReviewResult } from './types/datas/incident-report-datas/create-report-data.types';
import {
  CursorPage,
  InvalidCursorError,
  PageOptions,
} from '../../common/utils/cursor-pagination-helper.util';
import { Role } from '../../common/enums/role-enum';

/** The authenticated caller, taken from the verified token, never the body. */
export interface ServiceActor {
  id: string;
  role: Role;
  commandCenterId: string | null;
}

@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly incidentReportRepository: IncidentReportRepository,
    private readonly events: EventEmitter2,
  ) {}

  // =====================================================================
  // CREATE
  // =====================================================================

  /**
   * Creates an incident and announces it. Returns the new incident's id.
   *
   * `resolvedDriverId` is the rider the caller already established: the
   * authenticated rider for MANUAL_SOS, or the device's paired rider for
   * EDGE_AI. It is NOT taken from the request body. dto.driver_id is honoured
   * only for CENTER_MANUAL, where a command center may link a registered rider.
   *
   * The rider's own severity self-report is accepted here (it is what lets
   * nearby riders help on a MINOR incident); only staff can change it later,
   * see updateSeverity. The repository starts an ASSIST incident CLEAR and
   * everything else ACTIVE_THREAT.
   */
  async createIncident(
    dto: CreateIncidentDto,
    resolvedDriverId: string | null,
  ): Promise<string> {
    // The DTO checks these for HTTP callers. They are repeated here because
    // the service is also called from places that skip DTO validation (the
    // edge pipeline, the SLA sweeper, tests), and the database is the last
    // line of defence, not the first.
    const isWeapon =
      dto.threat_type === ThreatType.GUN ||
      dto.threat_type === ThreatType.BLADE;

    if (isWeapon && dto.threat_category !== ThreatCategory.HAZARD) {
      throw new BadRequestException(
        'GUN and BLADE incidents must have threat_category HAZARD',
      );
    }

    if (
      dto.threat_type === ThreatType.CONFRONTATION &&
      dto.threat_category === ThreatCategory.ASSIST
    ) {
      throw new BadRequestException(
        'CONFRONTATION incidents cannot have threat_category ASSIST',
      );
    }

    if (
      dto.trigger_source === TriggerSource.EDGE_AI &&
      dto.confidence_level == null
    ) {
      throw new BadRequestException(
        'EDGE_AI incidents require confidence_level',
      );
    }

    const isCenterManual = dto.trigger_source === TriggerSource.CENTER_MANUAL;
    const driverId = isCenterManual
      ? (dto.driver_id ?? null)
      : resolvedDriverId;

    // chck_incident_driver_required: only CENTER_MANUAL may have no rider.
    if (!isCenterManual && driverId === null) {
      throw new BadRequestException(
        'Could not determine which rider this incident belongs to',
      );
    }

    let incidentId: string | null;
    try {
      incidentId = await this.incidentRepository.createIncident({
        driver_id: driverId,
        device_id: dto.device_id ?? null,
        location: dto.location,
        trigger_source: dto.trigger_source,
        confidence_level: dto.confidence_level ?? null,
        threat_type: dto.threat_type,
        threat_category: dto.threat_category,
        severity: dto.severity,
        evidence: toIncidentEvidenceItems(dto.evidence),
      });
    } catch (error) {
      // An unknown device, or a rider that no longer exists (a stale pairing).
      if (isPgError(error, '23503')) {
        throw new BadRequestException('Unknown device or rider');
      }
      throw error;
    }

    if (incidentId === null) {
      throw new InternalServerErrorException('Incident could not be created');
    }

    // After the write has succeeded, never before. Listener failures are
    // logged by the event emitter and do not fail this request.
    const event: IncidentCreatedEvent = {
      incidentId,
      triggerSource: dto.trigger_source,
      threatType: dto.threat_type,
      threatCategory: dto.threat_category,
      severity: dto.severity ?? null,
      location: {
        longitude: dto.location.longitude,
        latitude: dto.location.latitude,
      },
      driverId,
    };
    this.events.emit(IncidentEvents.CREATED, event);

    return incidentId;
  }

  // =====================================================================
  // RESPONDER PROGRESS (each one announces the new status)
  // =====================================================================

  /** A responder claims an offered incident. Exactly one claimant can win. */
  async claimIncident(incidentId: string, responderId: string): Promise<void> {
    let won: boolean;
    try {
      won = await this.incidentRepository.claimIncident(
        incidentId,
        responderId,
      );
    } catch (error) {
      // Closed or cancelled incidents raise a check_violation.
      if (isPgError(error, '23514')) {
        throw new ConflictException('This incident is already closed');
      }
      // Two responders claiming at the same instant: the loser can be killed
      // by a deadlock (40P01, seen in ~7% of simulated races) or hit the
      // one-active-claim index (23505). Either way someone else won.
      if (isPgError(error, '40P01') || isPgError(error, '23505')) {
        throw new ConflictException(
          'This incident was already claimed, or the offer is no longer open',
        );
      }
      throw error;
    }
    if (!won) {
      throw new ConflictException(
        'This incident was already claimed, or the offer is no longer open',
      );
    }
    await this.announceStatus(incidentId);
  }

  async markEnRoute(incidentId: string, responderId: string): Promise<void> {
    const ok = await this.incidentRepository.markEnRoute(
      incidentId,
      responderId,
    );
    if (!ok) {
      throw new ConflictException(
        'You can only head to the scene after claiming this incident',
      );
    }
    await this.announceStatus(incidentId);
  }

  async findOpenIncidentsByDriver(driverId: string): Promise<IncidentEntity[]> {
    return this.incidentRepository.findOpenIncidentsByDriver(driverId);
  }

  /**
   * `confirmedById` is the authenticated user who confirmed the arrival, for
   * method 'manual'; pass null for 'gps'. Never accept it from the client.
   */
  async markArrived(
    incidentId: string,
    responderId: string,
    method: ArrivalConfirmationMethod,
    confirmedById: string | null,
  ): Promise<void> {
    const ok = await this.incidentRepository.markArrived(
      incidentId,
      responderId,
      method,
      confirmedById,
    );
    if (!ok) {
      throw new ConflictException(
        'You can only arrive at an incident you have claimed',
      );
    }
    await this.announceStatus(incidentId);
  }

  /** The claimant walks away before arriving; the incident returns to dispatch. */
  async standDown(incidentId: string, responderId: string): Promise<void> {
    const ok = await this.incidentRepository.standDown(incidentId, responderId);
    if (!ok) {
      throw new ConflictException(
        'You can only stand down before arriving at the scene',
      );
    }
    await this.announceStatus(incidentId);
  }

  // =====================================================================
  // PEERS
  // =====================================================================

  /**
   * A nearby rider responds to an alert. Every nearby rider is alerted, but
   * only a rider who may safely help can head to the scene (see
   * isPeerHelpEligible); acknowledging the alert or standing down is always
   * allowed. If the incident later stops being eligible, the peers already
   * heading there are stood down (see updateSeverity / updateThreatLevel).
   */
  async recordPeerResponse(
    incidentId: string,
    peerDriverId: string,
    status: PeerResponseStatus,
  ): Promise<void> {
    const incident = await this.incidentRepository.findIncidentById(incidentId);
    if (!incident) throw new NotFoundException('Incident not found');

    if (
      incident.status === IncidentStatus.RESOLVED ||
      incident.status === IncidentStatus.CANCELLED
    ) {
      throw new ConflictException('This incident is already closed');
    }

    if (isPhysicalPeerResponse(status) && !isPeerHelpEligible(incident)) {
      throw new ForbiddenException(
        'This incident is too dangerous for riders to attend. Please keep clear of the area.',
      );
    }

    const ok = await this.incidentRepository.recordPeerResponse(
      incidentId,
      peerDriverId,
      status,
    );
    if (!ok) {
      throw new ForbiddenException('You were not notified about this incident');
    }

    await this.safely(`peer response on incident ${incidentId}`, () => {
      const event: IncidentPeerRespondedEvent = {
        ...this.base(incident),
        peerDriverId,
        status,
      };
      this.events.emit(IncidentEvents.PEER_RESPONDED, event);
    });
  }

  // =====================================================================
  // INCIDENT-LEVEL TRANSITIONS
  // =====================================================================

  /** The claimant asks for independent (four-eyes) verification. */
  async requestVerification(
    incidentId: string,
    responderId: string,
  ): Promise<void> {
    const ok = await this.incidentRepository.requestVerification(
      incidentId,
      responderId,
    );
    if (!ok) {
      throw new ConflictException(
        'Verification can only be requested by the claimant, once on scene',
      );
    }
    await this.announceStatus(incidentId);
  }

  /** A second person verifies the scene outcome. Does not resolve it. */
  async verifyIncident(
    incidentId: string,
    verifierId: string,
    notes?: string | null,
  ): Promise<void> {
    const result: string = await this.incidentRepository.verifyIncident(
      incidentId,
      verifierId,
      notes,
    );
    switch (result) {
      case 'verified':
        break;
      case 'not_found':
        throw new NotFoundException('Incident not found');
      case 'forbidden':
        throw new ForbiddenException(
          'Only a responder, admin or super can verify an incident',
        );
      case 'own_claim':
        throw new ForbiddenException(
          'You cannot verify an incident you claimed yourself',
        );
      default:
        throw new ConflictException(
          'This incident is not waiting for verification',
        );
    }

    await this.afterIncidentChange(incidentId, (incident) => {
      const event: IncidentVerifiedEvent = {
        ...this.base(incident),
        verifiedById: verifierId,
      };
      this.events.emit(IncidentEvents.VERIFIED, event);
    });
  }

  async resolveIncident(
    incidentId: string,
    outcome: IncidentOutcome,
    resolvedById: string,
  ): Promise<void> {
    const result: string = await this.incidentRepository.resolveIncident(
      incidentId,
      outcome,
      resolvedById,
    );
    switch (result) {
      case 'resolved':
        break;
      case 'not_found':
        throw new NotFoundException('Incident not found');
      case 'forbidden':
        throw new ForbiddenException(
          'Only the claimant, an admin or a super can resolve this incident',
        );
      case 'invalid_outcome':
        throw new BadRequestException(
          'A resolved incident needs a real outcome',
        );
      case 'needs_verification':
        throw new ConflictException(
          'This incident needs independent verification before it can be resolved',
        );
      default:
        throw new ConflictException('This incident cannot be resolved now');
    }
    await this.announceStatus(incidentId);
  }

  /**
   * Changes how dangerous the scene is. Peers who were heading to the scene are
   * stood down (in the same database statement) when the scene is no longer
   * CLEAR, and told so.
   */
  async updateThreatLevel(
    incidentId: string,
    level: ThreatLevel,
    updatedById: string | null,
  ): Promise<void> {
    const standDownPeerIds = await this.incidentRepository.updateThreatLevel(
      incidentId,
      level,
      updatedById,
    );
    if (standDownPeerIds === null) {
      throw new ConflictException(
        'Incident not found, already closed, or already at that threat level',
      );
    }
    await this.announcePeerStandDown(
      incidentId,
      standDownPeerIds,
      'threat_level_changed',
    );
    await this.afterIncidentChange(incidentId, (incident) => {
      const event: IncidentThreatLevelChangedEvent = {
        ...this.base(incident),
        threatLevel: incident.threat_level,
      };
      this.events.emit(IncidentEvents.THREAT_LEVEL_CHANGED, event);
    });
  }

  /**
   * Assesses severity after creation. Only the claimant, an admin or a super
   * may; the rider's self-report is accepted at creation only. Peers who were
   * heading to the scene are stood down (in the same database statement) when
   * the new severity is anything but MINOR, and told so. Setting the severity
   * it already has is a no-op, not an error.
   */
  async updateSeverity(
    incidentId: string,
    severity: IncidentSeverity,
    updatedById: string,
  ): Promise<void> {
    const { result, standDownPeerIds } =
      await this.incidentRepository.updateSeverity(
        incidentId,
        severity,
        updatedById,
      );
    switch (result) {
      case 'updated':
        break;
      case 'unchanged':
        return;
      case 'not_found':
        throw new NotFoundException('Incident not found');
      case 'forbidden':
        throw new ForbiddenException(
          'Only the claimant, an admin or a super can assess severity',
        );
      case 'closed':
        throw new ConflictException('This incident is already closed');
    }

    await this.announcePeerStandDown(
      incidentId,
      standDownPeerIds,
      'severity_changed',
    );
    await this.afterIncidentChange(incidentId, (incident) => {
      const event: IncidentSeverityChangedEvent = {
        ...this.base(incident),
        severity: incident.severity,
      };
      this.events.emit(IncidentEvents.SEVERITY_CHANGED, event);
    });
  }

  /**
   * Hands the incident to a command center. `escalatedById` null means the
   * system (the SLA sweeper). Returns the escalation id.
   */
  async escalateIncident(
    incidentId: string,
    commandCenterId: string,
    reason: EscalationReason,
    escalatedById: string | null,
    notes?: string | null,
  ): Promise<string> {
    let escalationId: string | null;
    try {
      escalationId = await this.incidentRepository.escalateIncident(
        incidentId,
        commandCenterId,
        reason,
        escalatedById,
        notes,
      );
    } catch (error) {
      if (isPgError(error, '23503')) {
        throw new NotFoundException('Command center not found');
      }
      throw error;
    }
    if (escalationId === null) {
      throw new ConflictException(
        'Incident not found, already closed, or already escalated',
      );
    }

    const id = escalationId;
    await this.afterIncidentChange(incidentId, (incident) => {
      const status: IncidentStatusChangedEvent = {
        ...this.base(incident),
        status: incident.status,
      };
      this.events.emit(IncidentEvents.STATUS_CHANGED, status);

      const escalated: IncidentEscalatedEvent = {
        ...this.base(incident),
        escalationId: id,
        commandCenterId,
        reason,
      };
      this.events.emit(IncidentEvents.ESCALATED, escalated);

      /**
       * Notify the responder who is currently handling the incident
       * that it has been escalated to a command center.
       */
      if (incident.claimed_by_id) {
        this.events.emit('notification.created', {
          userId: incident.claimed_by_id,
          title: 'Dispatch update',
          body: 'The incident you are handling has been escalated to a command center.',
          type: 'incident_escalated',
          relatedEntityId: incidentId,
        });
      }
    });
    return id;
  }

  async cancelIncident(
    incidentId: string,
    cancelledById: string | null,
  ): Promise<void> {
    const ok = await this.incidentRepository.cancelIncident(
      incidentId,
      cancelledById,
    );
    if (!ok) {
      throw new ConflictException('Incident not found or already closed');
    }
    await this.announceStatus(incidentId);
  }

  // =====================================================================
  // INCIDENT READS
  // Staff-only. Restrict by role (and, for admins, by command center) in the
  // controller or a guard: these methods do not scope by caller.
  // =====================================================================

  async getIncident(incidentId: string): Promise<IncidentEntity> {
    const incident = await this.incidentRepository.findIncidentById(incidentId);
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  listIncidentsByStatus(
    statuses: IncidentStatus[],
    page: PageOptions = {},
  ): Promise<CursorPage<IncidentEntity>> {
    return this.withValidCursor(() =>
      this.incidentRepository.findIncidentsByStatus(statuses, page),
    );
  }

  listIncidentLogs(
    commandCenterId: string,
    page: PageOptions = {},
  ): Promise<CursorPage<IncidentLogEntity>> {
    return this.withValidCursor(() =>
      this.incidentRepository.findIncidentLogsByCommandCenter(
        commandCenterId,
        page,
      ),
    );
  }

  // =====================================================================
  // REPORTS
  // =====================================================================

  /** The reporter is the authenticated responder; their center owns the report. */
  async createReport(
    dto: CreateIncidentReportDto,
    reporterId: string,
  ): Promise<string> {
    let reportId: string | null;
    try {
      reportId = await this.incidentReportRepository.createReport({
        incident_id: dto.incident_id,
        reporter_id: reporterId,
        summary: dto.summary,
        disposition: dto.disposition,
        detailed_narrative: dto.detailed_narrative,
        evidence_urls: dto.evidence_urls,
        status: dto.status,
      });
    } catch (error) {
      if (isPgError(error, '23505')) {
        throw new ConflictException(
          'A report for this incident already exists for your command center',
        );
      }
      if (isPgError(error, '23503')) {
        throw new NotFoundException('Incident not found');
      }
      if (isPgError(error, '23514')) {
        throw new BadRequestException(
          'A disposition is required to submit a report',
        );
      }
      throw error;
    }
    if (reportId === null) {
      throw new ForbiddenException(
        'Only an active responder assigned to a command center can write a report',
      );
    }

    if (dto.status === 'submitted') await this.announceReport(reportId);
    return reportId;
  }

  async updateReportDraft(
    reportId: string,
    reporterId: string,
    dto: UpdateReportDraftDto,
  ): Promise<IncidentReportEntity> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Nothing to update');
    }

    let updated: IncidentReportEntity | null;
    try {
      updated = await this.incidentReportRepository.updateReportDraft(
        reportId,
        reporterId,
        dto,
      );
    } catch (error) {
      if (isPgError(error, '23514')) {
        throw new BadRequestException(
          'A disposition cannot be removed once the report has been submitted',
        );
      }
      throw error;
    }
    if (updated === null) {
      throw new ConflictException(
        'This report is not yours, or can no longer be edited',
      );
    }
    return updated;
  }

  /** First submission, or resubmission after a revision request. */
  async submitReport(
    reportId: string,
    submitterId: string,
    disposition?: IncidentDisposition | null,
  ): Promise<void> {
    let ok: boolean;
    try {
      ok = await this.incidentReportRepository.submitReport(
        reportId,
        submitterId,
        disposition,
      );
    } catch (error) {
      if (isPgError(error, '23514')) {
        throw new BadRequestException(
          'A disposition is required to submit a report',
        );
      }
      throw error;
    }
    if (!ok) {
      throw new ConflictException(
        'This report is not yours, or is not a draft or awaiting revision',
      );
    }
    await this.announceReport(reportId);
  }

  async startReportReview(reportId: string, reviewerId: string): Promise<void> {
    this.throwUnlessReviewed(
      await this.incidentReportRepository.startReportReview(
        reportId,
        reviewerId,
      ),
    );
    await this.announceReport(reportId);
  }

  async approveReport(
    reportId: string,
    reviewerId: string,
    notes?: string | null,
  ): Promise<void> {
    this.throwUnlessReviewed(
      await this.incidentReportRepository.approveReport(
        reportId,
        reviewerId,
        notes,
      ),
    );

    /**
     * Emit an event to trigger a push notification, informing the
     * reporter that their incident report has been approved.
     */
    const report = await this.incidentReportRepository.findReportById(reportId);
    if (report && report.assigned_reporter_id) {
      this.events.emit('notification.created', {
        userId: report.assigned_reporter_id,
        title: 'Report approved',
        body: 'Your last incident report has been reviewed and accepted.',
        type: 'report_review_result',
        relatedEntityId: reportId,
      });
    }

    await this.announceReport(reportId);
  }

  async requestReportRevision(
    reportId: string,
    reviewerId: string,
    notes: string,
  ): Promise<void> {
    // The schema requires notes for a revision request, and the reporter sees them.
    if (notes.trim() === '') {
      throw new BadRequestException(
        'Notes are required when requesting a revision',
      );
    }
    this.throwUnlessReviewed(
      await this.incidentReportRepository.requestReportRevision(
        reportId,
        reviewerId,
        notes,
      ),
    );

    /**
     * Emit an event to trigger a push notification, informing the
     * reporter that their incident report needs revision, including
     * the admin's feedback.
     */
    const report = await this.incidentReportRepository.findReportById(reportId);
    if (report && report.assigned_reporter_id) {
      this.events.emit('notification.created', {
        userId: report.assigned_reporter_id,
        title: 'Revision requested',
        body: 'Admin feedback added to your report. Please revise and resubmit.',
        type: 'report_review_result',
        relatedEntityId: reportId,
      });
    }

    await this.announceReport(reportId);
  }

  /**
   * Visible to a super, the report's own reporter, or an admin of the
   * report's command center.
   */
  async getReport(
    reportId: string,
    actor: ServiceActor,
  ): Promise<IncidentReportEntity> {
    const report = await this.incidentReportRepository.findReportById(reportId);
    if (!report) throw new NotFoundException('Report not found');

    const role: string = actor.role;
    const allowed =
      role === 'super' ||
      report.assigned_reporter_id === actor.id ||
      (role === 'admin' && actor.commandCenterId === report.command_center_id);
    if (!allowed) {
      throw new ForbiddenException('You cannot view this report');
    }
    return report;
  }

  /**
   * The review queue. An admin only ever sees their own command center, no
   * matter what the query asks for; a super may pick one or see all.
   */
  async listReportsAwaitingReview(
    actor: ServiceActor,
    query: FindReportsAwaitingReviewQueryDto,
  ): Promise<CursorPage<IncidentReportEntity>> {
    const role: string = actor.role;
    let commandCenterId: string | null;
    if (role === 'super') {
      commandCenterId = query.command_center_id ?? null;
    } else if (role === 'admin' && actor.commandCenterId !== null) {
      commandCenterId = actor.commandCenterId;
    } else {
      throw new ForbiddenException('You cannot view the review queue');
    }
    return this.withValidCursor(() =>
      this.incidentReportRepository.findReportsAwaitingReview(commandCenterId, {
        limit: query.limit,
        cursor: query.cursor,
      }),
    );
  }

  // =====================================================================
  // INTERNALS
  // =====================================================================

  /** A bad or tampered cursor is the caller's mistake: 400, not 500. */
  private async withValidCursor<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException('Invalid pagination cursor');
      }
      throw error;
    }
  }

  private throwUnlessReviewed(result: ReviewResult): void {
    switch (result) {
      case 'reviewed':
        return;
      case 'not_found':
        throw new NotFoundException('Report not found');
      case 'forbidden':
        throw new ForbiddenException(
          "Only a super, or an admin of the report's command center, can review it",
        );
      case 'own_report':
        throw new ForbiddenException(
          'You cannot review a report you submitted yourself',
        );
      case 'not_reviewable':
        throw new ConflictException(
          'This report is not in a state that can be reviewed',
        );
    }
  }

  private base(incident: IncidentEntity) {
    return {
      incidentId: incident.id,
      driverId: incident.driver_id,
      claimedById: incident.claimed_by_id,
      updatedAt: incident.updated_at.toISOString(),
    };
  }

  /** Reads the incident as it is now and announces its status. */
  private announceStatus(incidentId: string): Promise<void> {
    return this.afterIncidentChange(incidentId, (incident) => {
      const event: IncidentStatusChangedEvent = {
        ...this.base(incident),
        status: incident.status,
      };
      this.events.emit(IncidentEvents.STATUS_CHANGED, event);
    });
  }

  /**
   * Tells each stood-down peer, individually. Deliberately does not depend on
   * re-reading the incident: the database has already stood these riders down,
   * so the notice must go out even if that read fails. One peer's failing
   * listener never stops the others being told.
   */
  private async announcePeerStandDown(
    incidentId: string,
    peerDriverIds: string[],
    reason: PeerStandDownReason,
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    for (const peerDriverId of peerDriverIds) {
      await this.safely(
        `peer stand-down of ${peerDriverId} on incident ${incidentId}`,
        () => {
          const event: IncidentPeerStandDownEvent = {
            incidentId,
            peerDriverId,
            reason,
            updatedAt,
          };
          this.events.emit(IncidentEvents.PEER_STAND_DOWN, event);
        },
      );
    }
  }

  private announceReport(reportId: string): Promise<void> {
    return this.safelyAsync(`report ${reportId}`, async () => {
      const report =
        await this.incidentReportRepository.findReportById(reportId);
      if (!report) return;
      const event: ReportStatusChangedEvent = {
        reportId: report.id,
        incidentId: report.incident_id,
        commandCenterId: report.command_center_id,
        status: report.status,
        assignedReporterId: report.assigned_reporter_id,
        reviewedById: report.reviewed_by,
        updatedAt: report.updated_at.toISOString(),
      };
      this.events.emit(ReportEvents.STATUS_CHANGED, event);
    });
  }

  private afterIncidentChange(
    incidentId: string,
    publish: (incident: IncidentEntity) => void,
  ): Promise<void> {
    return this.safelyAsync(`incident ${incidentId}`, async () => {
      const incident =
        await this.incidentRepository.findIncidentById(incidentId);
      if (incident) publish(incident);
    });
  }

  private safely(what: string, fn: () => void): Promise<void> {
    return this.safelyAsync(what, () => Promise.resolve(fn()));
  }

  /**
   * Announcing happens AFTER the write has committed, so a failure here must
   * not turn a successful action into an error for the caller. Clients recover
   * by refetching over REST.
   */
  private async safelyAsync(
    what: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(
        `Could not publish events for ${what}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/** True for a Postgres error with the given SQLSTATE code. */
function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
