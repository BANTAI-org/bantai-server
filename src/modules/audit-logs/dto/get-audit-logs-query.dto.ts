import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction } from '../enums/audit-action.enum';

/**
 * Accepts repeated params (`?action=X&action=Y`) or comma-separated (`?action=X,Y`).
 */
function toArray(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;

  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class GetAuditLogsQueryDto {
  @ApiPropertyOptional({
    description: 'Number of records to return',
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque cursor from the previous page',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Required for Super Admins. Ignored for Admins.',
  })
  @IsOptional()
  @IsUUID()
  commandCenterId?: string;

  @ApiPropertyOptional({
    enum: AuditAction,
    isArray: true,
    description: 'Filter by one or multiple action types',
  })
  @Transform(({ value }) => toArray(value))
  @IsOptional()
  @IsArray()
  @IsEnum(AuditAction, { each: true })
  action?: AuditAction[];

  @ApiPropertyOptional({
    isArray: true,
    description:
      'Filter by category (maps to target_entity), e.g., "user_account", "incident"',
  })
  @Transform(({ value }) => toArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  category?: string[];

  @ApiPropertyOptional({
    description: 'Filter by the user who performed the action',
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on created_at. Date-only means 00:00:00.000Z.',
    example: '2026-10-19',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  from?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound on created_at. Date-only means 23:59:59.999Z.',
    example: '2026-10-19',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  to?: string;
}
