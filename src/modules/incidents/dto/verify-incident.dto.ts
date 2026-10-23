import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimToNull } from '../utils/trim-transform.util';
import { ApiProperty } from '@nestjs/swagger';
/** Body for verifyIncident. verifierId comes from the auth token. */
export class VerifyIncidentDto {
  @ApiProperty({
    required: false,
    description: 'Optional verification notes',
    example: 'Scene checked; details match the report.',
  })
  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
