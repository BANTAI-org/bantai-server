import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EscalationReason } from '../enums/escalation-reason.enum';
import { TrimToNull } from '../utils/trim-transform.util';
/**
 * Body for escalateIncident. escalatedById comes from the auth token; the SLA
 * sweeper calls the repository directly with null and does not use this DTO.
 */
export class EscalateIncidentDto {
  @IsUUID()
  command_center_id!: string;

  @IsEnum(EscalationReason)
  reason!: EscalationReason;

  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
