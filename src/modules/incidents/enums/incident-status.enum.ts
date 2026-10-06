/** incident_status_enum. 'CLAIMED' is the state lock: one responder won. */
export enum IncidentStatusEnum {
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
