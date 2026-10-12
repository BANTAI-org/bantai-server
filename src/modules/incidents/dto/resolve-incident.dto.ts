import { IsEnum, NotEquals } from 'class-validator';
import { IncidentOutcome } from '../enums/incident-outcome.enum';
/**
 * Body for resolveIncident. resolvedById comes from the auth token.
 * 'unresolved' is rejected: a RESOLVED incident must have a real outcome
 * (chck_incident_resolved_has_outcome).
 */
export class ResolveIncidentDto {
  @IsEnum(IncidentOutcome)
  @NotEquals('unresolved', {
    message: 'outcome cannot be "unresolved" when resolving',
  })
  outcome!: IncidentOutcome;
}
