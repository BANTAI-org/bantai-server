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
/**
 * Body for createReport. reporter_id is NOT a client field: it is the
 * authenticated responder, and their home command center becomes the report's
 * owner. If incident_id travels in the route instead (POST /incidents/:id/reports),
 * drop it from the body and set it in the controller.
 */
export class CreateIncidentReportDto {
  @IsUUID()
  incident_id!: string;

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
  @ValidateIf(
    (o: CreateIncidentReportDto) =>
      o.status === 'submitted' ||
      (o.disposition !== undefined && o.disposition !== null),
  )
  @IsEnum(IncidentDisposition)
  disposition?: IncidentDisposition | null;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  detailed_narrative?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2048, { each: true })
  evidence_urls?: string[];

  /** 'draft' (default), or 'submitted' to file it in one step. */
  @IsOptional()
  @IsIn(['draft', 'submitted'])
  status?: 'draft' | 'submitted';
}
