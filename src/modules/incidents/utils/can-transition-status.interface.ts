import { IncidentStatus } from '../enums/incident-status.enum';
import { INCIDENT_STATUS_TRANSITIONS } from './incident-statis-transition.util';

export function canTransitionIncidentStatus(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return INCIDENT_STATUS_TRANSITIONS[from].includes(to);
}
