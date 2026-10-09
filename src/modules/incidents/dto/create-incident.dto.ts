import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TriggerSource } from '../enums/trigger-source.enum';
import { type IncidentEvidenceItem } from '../types/evidence-item.type';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { isValidEvidence } from '../utils/evidences-policy.util';
import { GeoPointDTO } from './geo-point.dto';

const IsIncidentEvidence = () =>
  ValidateBy({
    name: 'isIncidentEvidence',
    validator: {
      validate: (value: unknown) => isValidEvidence(value),
      defaultMessage: () =>
        'evidence must be an array (max 100) of objects with a valid "key" (no scheme or leading "/", max 1024 bytes) and/or a non-blank "url"',
    },
  });

export class CreateIncidentDTO {
  @IsUUID()
  driver_id!: string;

  @IsUUID()
  device_id!: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => GeoPointDTO)
  location!: GeoPointDTO;

  @IsEnum(TriggerSource)
  @IsNotEmpty()
  trigger_source!: TriggerSource;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  detected_class!: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence_level!: number | null;

  @IsIncidentEvidence()
  evidence!: IncidentEvidenceItem[];

  @IsEnum(ThreatCategory)
  @IsNotEmpty()
  threat_category!: ThreatCategory;

  @IsEnum(ThreatType)
  @IsNotEmpty()
  threat_type!: ThreatType;

  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;
}
