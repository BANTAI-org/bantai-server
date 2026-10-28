import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus } from '../enums/report-status.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { TriggerSource } from '../enums/trigger-source.enum';

export type ReportSortBy =
  'status' | 'created_at' | 'updated_at' | 'submitted_at' | 'reviewed_at';

export type SortOrder = 'asc' | 'desc';

export const REPORT_SORT_BY_VALUES: readonly ReportSortBy[] = [
  'status',
  'created_at',
  'updated_at',
  'submitted_at',
  'reviewed_at',
] as const;

export const SORT_ORDER_VALUES: readonly SortOrder[] = ['asc', 'desc'] as const;

/**
 * Comma-or-repeated string → array. Mirrors the pattern already used by
 * FindIncidentsByStatusQueryDto so `?statuses=a,b` and `?statuses=a&statuses=b`
 * both work.
 */
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

export class ListIncidentReportsQueryDto {
  // ------------------------------------------------------------------
  // Report status filter — single-value `status` kept for backward compat
  // with the current Flutter build; `statuses` (array) is the new canonical.
  // If both are sent, `statuses` wins.
  // ------------------------------------------------------------------
  @ApiProperty({ required: false, enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiProperty({
    required: false,
    isArray: true,
    enum: ReportStatus,
    description: 'Report status array. Overrides `status` if both are set.',
  })
  @IsOptional()
  @Transform(parseCsvArray)
  @IsArray()
  @IsEnum(ReportStatus, { each: true })
  statuses?: ReportStatus[];

  // ------------------------------------------------------------------
  // Incident status filter — for the Operation tab (reports whose
  // underlying incident is e.g. AWAITING_VERIFICATION).
  // ------------------------------------------------------------------
  @ApiProperty({
    required: false,
    isArray: true,
    enum: IncidentStatus,
    description: 'Filter by the underlying incident status.',
  })
  @IsOptional()
  @Transform(parseCsvArray)
  @IsArray()
  @IsEnum(IncidentStatus, { each: true })
  incident_statuses?: IncidentStatus[];

  // ------------------------------------------------------------------
  // Trigger source filter (2.3)
  // ------------------------------------------------------------------
  @ApiProperty({
    required: false,
    isArray: true,
    enum: TriggerSource,
    description: 'Filter by incident trigger source (EDGE_AI, MANUAL_SOS, …).',
  })
  @IsOptional()
  @Transform(parseCsvArray)
  @IsArray()
  @IsEnum(TriggerSource, { each: true })
  trigger_sources?: TriggerSource[];

  // ------------------------------------------------------------------
  // Date range filter — YYYY-MM-DD, interpreted as Asia/Manila.
  // Filters on incident_report.submitted_at (drafts excluded).
  // ------------------------------------------------------------------
  @ApiProperty({
    required: false,
    description: 'Inclusive start date (YYYY-MM-DD, Asia/Manila)',
    example: '2026-10-20',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from_date must be YYYY-MM-DD' })
  from_date?: string;

  @ApiProperty({
    required: false,
    description: 'Inclusive end date (YYYY-MM-DD, Asia/Manila)',
    example: '2026-10-28',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to_date must be YYYY-MM-DD' })
  to_date?: string;

  // ------------------------------------------------------------------
  // Scoping / sorting / pagination
  // ------------------------------------------------------------------
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  command_center_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assigned_reporter_id?: string;

  @ApiProperty({
    required: false,
    enum: REPORT_SORT_BY_VALUES,
    default: 'submitted_at',
  })
  @IsOptional()
  @IsIn(REPORT_SORT_BY_VALUES as readonly string[])
  sort_by?: ReportSortBy;

  @ApiProperty({
    required: false,
    enum: SORT_ORDER_VALUES,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES as readonly string[])
  sort_order?: SortOrder;

  @ApiProperty({
    required: false,
    type: Number,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false, type: Number, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
