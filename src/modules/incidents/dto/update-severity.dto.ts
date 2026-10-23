import { IsEnum } from 'class-validator';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Body for updateSeverity. updatedById comes from the auth token. Only the
 * claimant, an admin or a super may assess severity after creation; the rider's
 * own self-report is accepted at creation only.
 */
export class UpdateSeverityDto {
  @ApiProperty({
    enum: IncidentSeverity,
    description: 'Assessed incident severity',
    example: IncidentSeverity.SERIOUS,
  })
  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;
}
