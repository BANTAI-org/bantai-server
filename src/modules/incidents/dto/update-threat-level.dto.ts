import { IsEnum } from 'class-validator';
import { ThreatLevel } from '../enums/threat-level.enum';
import { ApiProperty } from '@nestjs/swagger';
/** Body for updateThreatLevel. updatedById (audit actor) comes from the auth token. */
export class UpdateThreatLevelDto {
  @ApiProperty({
    enum: ThreatLevel,
    description: 'Updated threat level',
    example: ThreatLevel.ACTIVE_THREAT,
  })
  @IsEnum(ThreatLevel)
  threat_level!: ThreatLevel;
}
