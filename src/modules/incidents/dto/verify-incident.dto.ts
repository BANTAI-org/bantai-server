import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimToNull } from '../utils/trim-transform.util';
/** Body for verifyIncident. verifierId comes from the auth token. */
export class VerifyIncidentDto {
  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
