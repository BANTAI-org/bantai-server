import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { EscalationReason } from '../enums/escalation-reason.enum';
import { TrimToNull } from '../utils/trim-transform.util';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Body for escalateIncident. escalatedById comes from the auth token; the SLA
 * sweeper calls the repository directly with null and does not use this DTO.
 */
export class EscalateIncidentDto {
  @ApiProperty({
    description: 'UUID of the destination command center',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  command_center_id!: string;

  @ApiProperty({
    enum: EscalationReason,
    description: 'Reason for escalation',
    example: EscalationReason.MANUAL_INTERVENTION,
  })
  @IsEnum(EscalationReason)
  reason!: EscalationReason;

  @ApiProperty({
    required: false,
    description: 'Additional escalation context',
    example: 'Additional units are required.',
  })
  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
