import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { Trim } from '../utils/trim-transform.util';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Body for createReport. reporter_id is NOT a client field: it is the
 * authenticated responder, and their home command center becomes the report's
 * owner. If incident_id travels in the route instead (POST /incidents/:id/reports),
 * drop it from the body and set it in the controller.
 */
export class CreateIncidentReportDto {
  @ApiProperty({
    description: 'UUID of the incident associated with the report',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  incident_id!: string;

  @ApiProperty({
    description: 'Brief incident report summary',
    example: 'Responder attended a road collision near the intersection.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  summary!: string;

  /**
   * Required when filing straight to 'submitted'
   * (chck_disposition_required_past_draft); optional for a draft, but
   * validated whenever it is sent.
   */
  @ApiProperty({
    required: false,
    enum: IncidentDisposition,
    description: 'Report disposition; required when initially submitted',
    example: IncidentDisposition.FALSE_ALARM,
  })
  @ValidateIf(
    (o: CreateIncidentReportDto) =>
      o.status === 'submitted' ||
      (o.disposition !== undefined && o.disposition !== null),
  )
  @IsEnum(IncidentDisposition)
  disposition?: IncidentDisposition | null;

  @ApiProperty({
    required: false,
    description: 'Detailed narrative of the incident',
    example: 'The responder arrived at 14:35 and provided first aid.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  detailed_narrative?: string | null;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'URLs or object keys for report evidence',
    example: ['incidents/123/evidence/photo.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2048, { each: true })
  evidence_urls?: string[];

  /** 'draft' (default), or 'submitted' to file it in one step. */
  @ApiProperty({
    required: false,
    enum: ['draft', 'submitted'],
    description: 'Initial report status',
    example: 'draft',
  })
  @IsOptional()
  @IsIn(['draft', 'submitted'])
  status?: 'draft' | 'submitted';
}
