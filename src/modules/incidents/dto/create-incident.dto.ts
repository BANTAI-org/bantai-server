import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  IsString,
  IsNotEmpty,
} from 'class-validator';
import { GeoPoint } from '../../../common/interfaces/geo-location.interface';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { TriggerSource } from '../enums/trigger-source.enum';
import { IncidentEvidenceItemDto } from './evidence-item.dto';
import { ApiProperty } from '@nestjs/swagger';

export class LocationDto implements GeoPoint {
  @ApiProperty({
    description: 'Longitude of the incident location',
    example: 121.0437,
  })
  @IsNumber()
  @IsLongitude()
  longitude!: number;

  @ApiProperty({
    description: 'Latitude of the incident location',
    example: 14.676,
  })
  @IsNumber()
  @IsLatitude()
  latitude!: number;
}

@ValidatorConstraint({ name: 'incidentCrossFieldRules', async: false })
class IncidentCrossFieldRules implements ValidatorConstraintInterface {
  private violations(o: CreateIncidentDto): string[] {
    const out: string[] = [];
    const source = String(o.trigger_source);
    const type = String(o.threat_type);
    const category = String(o.threat_category);
    const hasConfidence =
      o.confidence_level !== undefined && o.confidence_level !== null;
    const hasDevice = o.device_id !== undefined && o.device_id !== null;
    const hasSerial =
      o.hardware_serial !== undefined && o.hardware_serial !== null;
    const hasDriver = o.driver_id !== undefined && o.driver_id !== null;

    if (source === 'EDGE_AI' && !hasConfidence) {
      out.push('confidence_level is required when trigger_source is EDGE_AI');
    }
    if (source !== 'EDGE_AI' && hasConfidence) {
      out.push('confidence_level must be omitted for human-raised incidents');
    }
    if (source === 'EDGE_AI' && !hasDevice && !hasSerial) {
      out.push(
        'device_id or hardware_serial is required when trigger_source is EDGE_AI',
      );
    }
    if (source !== 'CENTER_MANUAL' && hasDriver) {
      out.push(
        'driver_id can only be set when trigger_source is CENTER_MANUAL',
      );
    }
    if ((type === 'GUN' || type === 'BLADE') && category !== 'HAZARD') {
      out.push(
        'threat_category must be HAZARD when threat_type is GUN or BLADE',
      );
    }
    if (type === 'CONFRONTATION' && category === 'ASSIST') {
      out.push(
        'threat_category cannot be ASSIST when threat_type is CONFRONTATION',
      );
    }
    return out;
  }

  validate(_value: unknown, args: ValidationArguments): boolean {
    return this.violations(args.object as CreateIncidentDto).length === 0;
  }

  defaultMessage(args: ValidationArguments): string {
    return this.violations(args.object as CreateIncidentDto).join('; ');
  }
}

export class CreateIncidentDto {
  @ApiProperty({
    enum: TriggerSource,
    description: 'Source that triggered the incident',
    example: TriggerSource.MANUAL_SOS,
  })
  @IsEnum(TriggerSource)
  @Validate(IncidentCrossFieldRules)
  trigger_source!: TriggerSource;

  @ApiProperty({
    type: () => LocationDto,
    description: 'Geographic location of the incident',
    example: { latitude: 14.676, longitude: 121.0437 },
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @ApiProperty({
    enum: ThreatType,
    description: 'Primary threat type',
    example: ThreatType.CONFRONTATION,
  })
  @IsEnum(ThreatType)
  threat_type!: ThreatType;

  @ApiProperty({
    enum: ThreatCategory,
    description: 'Threat category',
    example: ThreatCategory.HAZARD,
  })
  @IsEnum(ThreatCategory)
  threat_category!: ThreatCategory;

  @ApiProperty({
    required: false,
    description:
      'AI confidence from 0 to 1; required only for EDGE_AI incidents',
    example: 0.94,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  confidence_level?: number | null;

  @ApiProperty({
    required: false,
    description: 'Source device UUID; used for EDGE_AI incidents',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  device_id?: string | null;

  @ApiProperty({
    required: false,
    description:
      'Source device Hardware Serial; used for EDGE_AI if device_id is omitted',
    example: 'KVM-YOLO-QUEZON-CITY-01',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  hardware_serial?: string | null;

  @ApiProperty({
    required: false,
    description: 'Driver UUID; accepted only for CENTER_MANUAL incidents',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  driver_id?: string | null;

  @ApiProperty({
    required: false,
    enum: IncidentSeverity,
    description: 'Incident severity',
    example: IncidentSeverity.CRITICAL,
  })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiProperty({
    required: false,
    type: () => [IncidentEvidenceItemDto],
    description: 'Evidence attached to the incident',
    example: [
      { key: 'incidents/evidence/photo.jpg', content_type: 'image/jpeg' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => IncidentEvidenceItemDto)
  evidence?: IncidentEvidenceItemDto[];
}
