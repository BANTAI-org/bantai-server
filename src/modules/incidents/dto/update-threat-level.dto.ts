import { IsEnum } from 'class-validator';
import { ThreatLevel } from '../enums/threat-level.enum';
/** Body for updateThreatLevel. updatedById (audit actor) comes from the auth token. */
export class UpdateThreatLevelDto {
  @IsEnum(ThreatLevel)
  threat_level!: ThreatLevel;
}
