import { IsEnum } from 'class-validator';
import { IncidentSeverity } from '../enums/incident-severity.enum';
/**
 * Body for updateSeverity. updatedById comes from the auth token. Only the
 * claimant, an admin or a super may assess severity after creation; the rider's
 * own self-report is accepted at creation only.
 */
export class UpdateSeverityDto {
  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;
}
