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
} from 'class-validator';
import { GeoPoint } from '../../../common/interfaces/geo-location.interface';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { TriggerSource } from '../enums/trigger-source.enum';
import { IncidentEvidenceItemDto } from './evidence-item.dto';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Request shape of a location. Must stay compatible with the shared GeoPoint.
 * @IsNumber first: IsLongitude / IsLatitude alone also accept numeric STRINGS
 * ("121.03"), which would reach the repository typed as number but be a string.
 * (GeoPointDTO in geo-point.dto.ts is the same shape; consider keeping one.)
 */
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

/**
 * Cross-field rules on a new incident, checked up front so the client gets a
 * 400 with a readable reason instead of a raw check_violation.
 *
 * Enforced by the database too:
 *   - chck_incident_edge_ai_confidence   EDGE_AI needs confidence_level
 *   - chck_incident_weapon_is_hazard     GUN / BLADE must be HAZARD
 *   - chck_incident_confrontation_not_assist
 *
 * App rules (stricter than the database):
 *   - confidence_level is omitted for human-raised incidents
 *   - EDGE_AI needs device_id: the rider is resolved from the device's active
 *     pairing, and without a rider chck_incident_driver_required fails
 *   - driver_id is only accepted on CENTER_MANUAL; for every other source it
 *     comes from the authenticated rider or the device pairing, so a client
 *     that sends one gets a 400 instead of being silently ignored
 */
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
    const hasDriver = o.driver_id !== undefined && o.driver_id !== null;

    if (source === 'EDGE_AI' && !hasConfidence) {
      out.push('confidence_level is required when trigger_source is EDGE_AI');
    }
    if (source !== 'EDGE_AI' && hasConfidence) {
      out.push('confidence_level must be omitted for human-raised incidents');
    }
    if (source === 'EDGE_AI' && !hasDevice) {
      out.push('device_id is required when trigger_source is EDGE_AI');
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

/**
 * Body for creating an incident. Maps to CreateIncidentData.
 *
 * driver_id is deliberately NOT a free client field for most sources: for
 * MANUAL_SOS take it from the authenticated rider, for EDGE_AI resolve it from
 * the device's active pairing. It is only accepted here so a command center can
 * link a registered rider on a CENTER_MANUAL report (omit it for a walk-in);
 * any other trigger_source that sends one is rejected (see the rules above).
 * An EDGE_AI device with no active pairing cannot be resolved to a rider: the
 * service must answer that itself (409/422), it is not visible in this DTO.
 */
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

  /** 0..1, NUMERIC(5,4). Required for EDGE_AI, omitted otherwise. */
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
    description: 'Source device UUID; required for EDGE_AI incidents',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  device_id?: string | null;

  @ApiProperty({
    required: false,
    description: 'Driver UUID; accepted only for CENTER_MANUAL incidents',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  driver_id?: string | null;

  /** Defaults to UNKNOWN in the database when omitted. */
  @ApiProperty({
    required: false,
    enum: IncidentSeverity,
    description: 'Incident severity',
    example: IncidentSeverity.CRITICAL,
  })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  /** Defaults to []. Max 100 items (database limit). */
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
