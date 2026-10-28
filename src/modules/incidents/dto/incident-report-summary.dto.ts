import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus } from '../enums/report-status.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { TriggerSource } from '../enums/trigger-source.enum';

const parseCsvArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return value;
  const parts: unknown[] | null = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'string'
      ? value.split(',')
      : null;
  if (parts === null) return value;
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : part))
    .filter((part) => part !== '');
};

export class IncidentReportSummaryQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  command_center_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assigned_reporter_id?: string;

  @ApiProperty({ required: false, enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiProperty({ required: false, isArray: true, enum: ReportStatus })
  @IsOptional()
  @Transform(parseCsvArray)
  @IsArray()
  @IsEnum(ReportStatus, { each: true })
  statuses?: ReportStatus[];

  @ApiProperty({ required: false, isArray: true, enum: IncidentStatus })
  @IsOptional()
  @Transform(parseCsvArray)
  @IsArray()
  @IsEnum(IncidentStatus, { each: true })
  incident_statuses?: IncidentStatus[];

  @ApiProperty({ required: false, isArray: true, enum: TriggerSource })
  @IsOptional()
  @Transform(parseCsvArray)
  @IsArray()
  @IsEnum(TriggerSource, { each: true })
  trigger_sources?: TriggerSource[];

  @ApiProperty({ required: false, description: 'YYYY-MM-DD, Asia/Manila' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from_date?: string;

  @ApiProperty({ required: false, description: 'YYYY-MM-DD, Asia/Manila' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to_date?: string;
}

export class IncidentReportSummaryResponseDto {
  @ApiProperty() total!: number;
  @ApiProperty() draft!: number;
  @ApiProperty() submitted!: number;
  @ApiProperty() under_review!: number;
  @ApiProperty() needs_revision!: number;
  @ApiProperty() approved!: number;
  @ApiProperty({ description: 'submitted + under_review' })
  pending_review!: number;
  @ApiProperty({ description: 'Alias of pending_review' })
  awaiting_verification!: number;
  @ApiProperty({ description: 'Alias of needs_revision' })
  request_revision!: number;
  @ApiProperty({ description: 'Alias of draft' })
  awaiting_submission!: number;
}
