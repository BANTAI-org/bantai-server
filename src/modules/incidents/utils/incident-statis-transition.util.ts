import { IncidentStatus } from '../enums/incident-status.enum';
/**
 * Allowed status moves. Mirrors the database function
 * is_valid_incident_transition(from, to), which the lifecycle trigger uses to
 * reject anything else. Use it to fail fast in the API with a clean error
 * instead of a trigger exception.
 */
export const INCIDENT_STATUS_TRANSITIONS: Readonly<
  Record<IncidentStatus, readonly IncidentStatus[]>
> = {
  [IncidentStatus.DETECTED]: [
    IncidentStatus.DISPATCHING,
    IncidentStatus.CLAIMED,
    IncidentStatus.ESCALATED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.DISPATCHING]: [
    IncidentStatus.CLAIMED,
    IncidentStatus.ESCALATED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.CLAIMED]: [
    IncidentStatus.EN_ROUTE,
    IncidentStatus.ON_SCENE,
    IncidentStatus.DISPATCHING,
    IncidentStatus.ESCALATED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.EN_ROUTE]: [
    IncidentStatus.ON_SCENE,
    IncidentStatus.DISPATCHING,
    IncidentStatus.ESCALATED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.ON_SCENE]: [
    IncidentStatus.AWAITING_VERIFICATION,
    IncidentStatus.RESOLVED,
    IncidentStatus.ESCALATED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.AWAITING_VERIFICATION]: [
    IncidentStatus.ON_SCENE,
    IncidentStatus.RESOLVED,
    IncidentStatus.ESCALATED,
    IncidentStatus.CANCELLED,
  ],
  [IncidentStatus.ESCALATED]: [
    IncidentStatus.DISPATCHING,
    IncidentStatus.CLAIMED,
    IncidentStatus.EN_ROUTE,
    IncidentStatus.ON_SCENE,
    IncidentStatus.AWAITING_VERIFICATION,
    IncidentStatus.RESOLVED,
    IncidentStatus.CANCELLED,
  ],
  // Terminal states.
  [IncidentStatus.RESOLVED]: [],
  [IncidentStatus.CANCELLED]: [],
};
