import { GeoPoint } from '../../../common/interfaces/geo-location.interface';
import { EscalationReason } from '../enums/escalation-reason.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { PeerResponseStatus } from '../enums/peer-response-status.enum';
import { ReportStatus } from '../enums/report-status.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { TriggerSource } from '../enums/trigger-source.enum';

export const IncidentEvents = {
  CREATED: 'incident.created',
  STATUS_CHANGED: 'incident.status_changed',
  ESCALATED: 'incident.escalated',
  VERIFIED: 'incident.verified',
  THREAT_LEVEL_CHANGED: 'incident.threat_level_changed',
  PEER_RESPONDED: 'incident.peer_responded',
  SEVERITY_CHANGED: 'incident.severity_changed',
  /** Sent to ONE rider: stop heading to / leave the scene. */
  PEER_STAND_DOWN: 'incident.peer_stand_down',
  TRACKING_UPDATED: 'incident.tracking_updated', // ← NEW
} as const;

export const ReportEvents = {
  STATUS_CHANGED: 'report.status_changed',
} as const;

export const Rooms = {
  user: (userId: string) => `user:${userId}`,
  role: (role: string) => `role:${role}`,
  commandCenter: (id: string) => `cc:${id}`,
  /** Joined by whoever is offered or involved in an incident. */
  incident: (id: string) => `incident:${id}`,
} as const;

export interface IncidentCreatedEvent {
  incidentId: string;
  triggerSource: TriggerSource;
  threatType: ThreatType;
  threatCategory: ThreatCategory;
  /** null = not provided, the database default (UNKNOWN) applies. */
  severity: IncidentSeverity | null;
  location: GeoPoint;
  /** null only for a CENTER_MANUAL walk-in report. */
  driverId: string | null;
}

interface IncidentEventBase {
  incidentId: string;
  driverId: string | null;
  claimedById: string | null;
  updatedAt: string;
}

export interface IncidentStatusChangedEvent extends IncidentEventBase {
  status: IncidentStatus;
}

export interface IncidentEscalatedEvent extends IncidentEventBase {
  escalationId: string;
  commandCenterId: string;
  reason: EscalationReason;
}

export interface IncidentVerifiedEvent extends IncidentEventBase {
  verifiedById: string;
}

export interface IncidentThreatLevelChangedEvent extends IncidentEventBase {
  threatLevel: ThreatLevel;
}

export interface IncidentPeerRespondedEvent extends IncidentEventBase {
  peerDriverId: string;
  status: PeerResponseStatus;
}

export interface IncidentSeverityChangedEvent extends IncidentEventBase {
  severity: IncidentSeverity;
}

/** Why a peer who was heading to (or at) the scene is being told to stand down. */
export type PeerStandDownReason = 'severity_changed' | 'threat_level_changed';

/**
 * Deliberately NOT based on IncidentEventBase: it goes to a single peer, so it
 * carries no rider or claimant ids.
 */
export interface IncidentPeerStandDownEvent {
  incidentId: string;
  peerDriverId: string;
  reason: PeerStandDownReason;
  updatedAt: string;
}

export interface ReportStatusChangedEvent {
  reportId: string;
  incidentId: string;
  commandCenterId: string;
  status: ReportStatus;
  assignedReporterId: string | null;
  reviewedById: string | null;
  updatedAt: string;
}

/**
 * Deliberately NOT based on IncidentEventBase: it always targets
 * Rooms.incident(incidentId), so it carries no audience-picking ids.
 */
export interface IncidentTrackingUpdatedEvent {
  incidentId: string;
  responderId: string;
  responderName: string | null;
  distanceMeters: number;
  etaSeconds: number;
  lastSeenAt: string;
  computedAt: string;
}
