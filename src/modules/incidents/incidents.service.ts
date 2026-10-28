import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
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

import type {
  IncidentReportSummaryQueryDto,
  IncidentReportSummaryResponseDto,
} from './dto/incident-report-summary.dto';
import type { ListIncidentReportsQueryDto } from './dto/list-incident-report-query.dto';
import type { IncidentTimelineResponse } from './interfaces/timeline-event.interface';
import { OffsetPageResponseDto } from '../../common/dto/offset-based-pagination.dto';
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
import { TrackingService } from './incident-tracking.service';
import { ReviewResult } from './types/datas/incident-report-datas/create-report-data.types';
import {
  CursorPage,
  InvalidCursorError,
  PageOptions,
} from '../../common/utils/cursor-pagination-helper.util';
import { Role } from '../../common/enums/role-enum';

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
    private readonly trackingService: TrackingService,
    private readonly events: EventEmitter2,
  ) {}

  async createIncident(
    dto: CreateIncidentDto,
    resolvedDriverId: string | null,
  ): Promise<string> {
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
      if (isPgError(error, '23503')) {
        throw new BadRequestException('Unknown device or rider');
      }
      throw error;
    }

    if (incidentId === null) {
      throw new InternalServerErrorException('Incident could not be created');
    }

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

  async createEdgeIncident(dto: CreateIncidentDto): Promise<string> {
    const identifier = dto.device_id || dto.hardware_serial;

    if (!identifier) {
      throw new BadRequestException(
        'Either device_id or hardware_serial is required',
      );
    }

    const deviceData =
      await this.incidentRepository.getDeviceAndDriver(identifier);

    if (!deviceData) {
      throw new BadRequestException(
        'Device not found or is not currently paired',
      );
    }

    if (!deviceData.driverId) {
      throw new BadRequestException('Device is not paired with a driver');
    }

    dto.device_id = deviceData.deviceId;
    return this.createIncident(dto, deviceData.driverId);
  }

  async claimIncident(incidentId: string, responderId: string): Promise<void> {
    let won: boolean;
    try {
      won = await this.incidentRepository.claimIncident(
        incidentId,
        responderId,
      );
    } catch (error) {
      if (isPgError(error, '23514')) {
        throw new ConflictException('This incident is already closed');
      }
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
      const incident =
        await this.incidentRepository.findIncidentById(incidentId);
      this.logger.warn(
        `markEnRoute failed: incidentId=${incidentId}, responderId=${responderId}, ` +
          `incident.status=${incident?.status ?? 'NOT_FOUND'}, ` +
          `claimed_by_id=${incident?.claimed_by_id ?? 'NULL'}`,
      );
      throw new ConflictException(
        'You can only head to the scene after claiming this incident',
      );
    }
    await this.announceStatus(incidentId);
  }

  async findOpenIncidentsByDriver(driverId: string): Promise<IncidentEntity[]> {
    return this.incidentRepository.findOpenIncidentsByDriver(driverId);
  }

  async getCurrentAssignment(
    responderId: string,
  ): Promise<IncidentEntity | null> {
    return this.incidentRepository.findCurrentAssignment(responderId);
  }

  async getUnresolvedIncidentsForResponder(
    responderId: string,
  ): Promise<IncidentEntity[]> {
    return this.incidentRepository.findUnresolvedIncidentsForResponder(
      responderId,
    );
  }

  async getPendingOffers(responderId: string): Promise<IncidentEntity[]> {
    return this.incidentRepository.findPendingOffers(responderId);
  }

  async getAssignmentHistory(
    responderId: string,
    limit: number,
    offset: number,
  ): Promise<IncidentEntity[]> {
    return this.incidentRepository.findAssignmentHistory(
      responderId,
      limit,
      offset,
    );
  }

  async markArrived(
    incidentId: string,
    responderId: string,
    method: ArrivalConfirmationMethod,
    confirmedById: string | null,
  ): Promise<void> {
    const tracking = await this.trackingService.computeTracking(incidentId);
    if (!tracking) {
      throw new NotFoundException('Incident not found');
    }

    if (tracking.distance_meters !== null && tracking.distance_meters > 30) {
      throw new BadRequestException(
        `You are ${tracking.distance_meters}m away from the incident. ` +
          `You must be within 30m to mark yourself on scene.`,
      );
    }

    if (
      method === ArrivalConfirmationMethod.GPS &&
      tracking.distance_meters === null
    ) {
      throw new BadRequestException(
        'No fresh GPS fix available. Please update your location and try again.',
      );
    }

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

  async standDown(incidentId: string, responderId: string): Promise<void> {
    const ok = await this.incidentRepository.standDown(incidentId, responderId);
    if (!ok) {
      throw new ConflictException(
        'You can only stand down before arriving at the scene',
      );
    }
    await this.announceStatus(incidentId);
  }

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
    const { result, standDownPeerIds } =
      await this.incidentRepository.resolveIncidentAndStandDownPeers(
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

    await this.announcePeerStandDown(
      incidentId,
      standDownPeerIds,
      'incident_closed',
    );

    // The DB trigger incident_after_change already inserted the inbox rows
    // for every responder who was CLAIMED / EN_ROUTE / ARRIVED at resolve
    // time. Emit with skipInbox so FCM fires without duplicating the rows.
    await this.emitIncidentResolvedNotifications(incidentId);

    await this.announceStatus(incidentId);
  }

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

      // The DB trigger incident_after_change already inserted the
      // notification row for the claimant. Skip the inbox insert so we
      // don't duplicate, but still emit so FCM fires.
      if (incident.claimed_by_id) {
        this.events.emit('notification.created', {
          userId: incident.claimed_by_id,
          title: 'Incident escalated',
          body: 'The incident you are handling has been escalated to a command center.',
          type: 'incident_escalated',
          tone: 'attention',
          relatedEntity: 'incident',
          relatedEntityId: incidentId,
          skipInbox: true,
        });
      }
    });
    return id;
  }

  async assignResponderByCenter(
    incidentId: string,
    responderId: string,
    assignedById: string,
  ): Promise<string> {
    const incident = await this.incidentRepository.findIncidentById(incidentId);
    if (!incident) throw new NotFoundException('Incident not found');

    if (incident.status !== IncidentStatus.ESCALATED) {
      throw new ConflictException(
        'Only escalated incidents can be assigned by a command center',
      );
    }

    let assignmentId: string;
    try {
      assignmentId = await this.incidentRepository.createCenterAssignment(
        incidentId,
        responderId,
        assignedById,
      );
    } catch (error) {
      if (isPgError(error, '23505')) {
        throw new ConflictException(
          'This responder is already assigned to this incident',
        );
      }
      if (isPgError(error, '23503')) {
        throw new NotFoundException('Responder not found');
      }
      throw error;
    }

    this.events.emit('notification.created', {
      userId: responderId,
      title: 'New dispatch assignment',
      body: 'A command center has assigned you to an incident.',
      type: 'dispatch_assigned',
      tone: 'attention',
      relatedEntity: 'incident',
      relatedEntityId: incidentId,
      skipInbox: true,
    });

    return assignmentId;
  }

  async cancelIncident(
    incidentId: string,
    cancelledById: string | null,
  ): Promise<void> {
    const { cancelled, standDownPeerIds } =
      await this.incidentRepository.cancelIncidentAndStandDownPeers(
        incidentId,
        cancelledById,
      );

    if (!cancelled) {
      throw new ConflictException('Incident not found or already closed');
    }

    await this.announcePeerStandDown(
      incidentId,
      standDownPeerIds,
      'incident_closed',
    );
    await this.announceStatus(incidentId);
  }

  async getIncident(incidentId: string): Promise<IncidentEntity> {
    const incident = await this.incidentRepository.findIncidentById(incidentId);
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  async getIncidentForUser(
    incidentId: string,
    userId: string,
    role: Role,
  ): Promise<IncidentEntity> {
    const allowed = await this.incidentRepository.canUserViewIncident(
      incidentId,
      userId,
      role,
    );
    if (!allowed) throw new ForbiddenException('You cannot view this incident');

    if (role === Role.DRIVER) {
      const enriched = await this.incidentRepository.findIncidentByIdForActor(
        incidentId,
        userId,
      );
      if (!enriched) throw new NotFoundException('Incident not found');
      return enriched;
    }

    if (role === Role.RESPONDER) {
      const enriched = await this.incidentRepository.findIncidentByIdForActor(
        incidentId,
        userId,
      );
      if (!enriched) throw new NotFoundException('Incident not found');
      return enriched;
    }

    return this.getIncident(incidentId);
  }

  async getTimeline(
    incidentId: string,
    userId: string,
    role: Role,
  ): Promise<IncidentTimelineResponse> {
    const allowed = await this.incidentRepository.canUserViewIncident(
      incidentId,
      userId,
      role,
    );
    if (!allowed) throw new ForbiddenException('You cannot view this incident');

    const events =
      await this.incidentRepository.getIncidentTimeline(incidentId);
    return { incident_id: incidentId, events };
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

    const report = await this.incidentReportRepository.findReportById(reportId);
    if (report && report.assigned_reporter_id) {
      this.events.emit('notification.created', {
        userId: report.assigned_reporter_id,
        title: 'Report approved',
        body:
          report.reviewer_notes ??
          'Your incident report has been reviewed and approved.',
        type: 'report_review_result',
        tone: 'success',
        relatedEntity: 'incident_report',
        relatedEntityId: reportId,
        skipInbox: true,
      });
    }

    await this.announceReport(reportId);
  }

  async requestReportRevision(
    reportId: string,
    reviewerId: string,
    notes: string,
  ): Promise<void> {
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

    const report = await this.incidentReportRepository.findReportById(reportId);
    if (report && report.assigned_reporter_id) {
      this.events.emit('notification.created', {
        userId: report.assigned_reporter_id,
        title: 'Report needs revision',
        body: notes,
        type: 'report_review_result',
        tone: 'attention',
        relatedEntity: 'incident_report',
        relatedEntityId: reportId,
        skipInbox: true,
      });
    }

    await this.announceReport(reportId);
  }

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
        trigger_sources: query.trigger_sources,
        from_date: query.from_date,
        to_date: query.to_date,
        limit: query.limit,
        cursor: query.cursor,
      }),
    );
  }

  async getReportSummary(
    actor: ServiceActor,
    query: IncidentReportSummaryQueryDto,
  ): Promise<IncidentReportSummaryResponseDto> {
    const scope = this.buildReportScope(actor, query);
    return this.incidentReportRepository.getReportSummary(scope, {
      status: query.status,
      statuses: query.statuses,
      incident_statuses: query.incident_statuses,
      trigger_sources: query.trigger_sources,
      from_date: query.from_date,
      to_date: query.to_date,
    });
  }

  async listReports(
    actor: ServiceActor,
    query: ListIncidentReportsQueryDto,
  ): Promise<OffsetPageResponseDto<IncidentReportEntity>> {
    const scope = this.buildReportScope(actor, query);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const { items, total } =
      await this.incidentReportRepository.findReportsPaginated(scope, {
        status: query.status,
        statuses: query.statuses,
        incident_statuses: query.incident_statuses,
        trigger_sources: query.trigger_sources,
        from_date: query.from_date,
        to_date: query.to_date,
        sortBy: query.sort_by ?? 'submitted_at',
        sortOrder: query.sort_order ?? 'desc',
        limit,
        offset,
      });

    return OffsetPageResponseDto.from(items, total, limit, offset);
  }

  private buildReportScope(
    actor: ServiceActor,
    query: {
      command_center_id?: string;
      assigned_reporter_id?: string;
    },
  ): { commandCenterId?: string | null; reporterId?: string | null } {
    const role: string = actor.role;

    if (role === 'responder') {
      return { reporterId: actor.id };
    }

    if (role === 'admin') {
      if (!actor.commandCenterId) {
        throw new ForbiddenException(
          'Admin is not assigned to a command center',
        );
      }
      return {
        commandCenterId: actor.commandCenterId,
        reporterId: query.assigned_reporter_id ?? undefined,
      };
    }

    if (role === 'super') {
      return {
        commandCenterId: query.command_center_id ?? undefined,
        reporterId: query.assigned_reporter_id ?? undefined,
      };
    }

    throw new ForbiddenException('You cannot view incident reports');
  }

  @OnEvent('incident.sla_timeout')
  async handleSlaTimeout(event: { incidentId: string }): Promise<void> {
    try {
      const stillUnclaimed = await this.incidentRepository.isIncidentUnclaimed(
        event.incidentId,
      );
      if (!stillUnclaimed) {
        this.logger.log(
          `Skipping SLA escalation for incident ${event.incidentId}: ` +
            `it was claimed before escalation could execute.`,
        );
        return;
      }

      const ccId = await this.incidentRepository.findFirstCommandCenterId();
      if (!ccId) {
        this.logger.error('No command center exists to escalate to.');
        return;
      }

      await this.escalateIncident(
        event.incidentId,
        ccId,
        EscalationReason.SLA_TIMEOUT,
        null,
        'Auto-escalated: No responder claimed within 60 seconds.',
      );

      this.logger.log(
        `Successfully auto-escalated incident ${event.incidentId} to CC ${ccId}.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to auto-escalate incident ${event.incidentId}`,
        error,
      );
    }
  }

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

  private announceStatus(incidentId: string): Promise<void> {
    return this.afterIncidentChange(incidentId, (incident) => {
      const event: IncidentStatusChangedEvent = {
        ...this.base(incident),
        status: incident.status,
      };
      this.events.emit(IncidentEvents.STATUS_CHANGED, event);
    });
  }

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

  private async emitIncidentResolvedNotifications(
    incidentId: string,
  ): Promise<void> {
    try {
      const responderIds =
        await this.incidentRepository.getActiveResponderIdsOnIncident(
          incidentId,
        );
      for (const responderId of responderIds) {
        this.events.emit('notification.created', {
          userId: responderId,
          title: 'Incident resolved',
          body: 'The incident you were dispatched to has been resolved.',
          type: 'incident_resolved',
          tone: 'success',
          relatedEntity: 'incident',
          relatedEntityId: incidentId,
          skipInbox: true,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit resolved notifications for incident ${incidentId}`,
        error instanceof Error ? error.stack : String(error),
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

function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
