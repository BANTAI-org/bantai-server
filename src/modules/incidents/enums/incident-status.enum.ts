/**
 * Postgres: incident_status_enum
 * Lifecycle of an incident. CLAIMED is the state lock: from CLAIMED through
 * AWAITING_VERIFICATION a claimed_by_id must be set; before that it must be NULL.
 */
export enum IncidentStatus {
  DETECTED = 'DETECTED',
  DISPATCHING = 'DISPATCHING',
  CLAIMED = 'CLAIMED',
  EN_ROUTE = 'EN_ROUTE',
  ON_SCENE = 'ON_SCENE',
  AWAITING_VERIFICATION = 'AWAITING_VERIFICATION',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}
