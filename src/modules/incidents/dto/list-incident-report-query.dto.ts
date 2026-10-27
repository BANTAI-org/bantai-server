import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus } from '../enums/report-status.enum';

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

export class ListIncidentReportsQueryDto {
  @ApiProperty({
    required: false,
    enum: ReportStatus,
    description: 'Optional exact-status filter',
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiProperty({
    required: false,
    description:
      'Command center UUID. Honored for super only; admin is scoped to own; responder is scoped to self.',
  })
  @IsOptional()
  @IsUUID()
  command_center_id?: string;

  @ApiProperty({
    required: false,
    description:
      'Reporter UUID filter. Honored for admins (own CC only) and supers. Ignored for responders.',
  })
  @IsOptional()
  @IsUUID()
  assigned_reporter_id?: string;

  @ApiProperty({
    required: false,
    enum: REPORT_SORT_BY_VALUES,
    default: 'created_at',
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
