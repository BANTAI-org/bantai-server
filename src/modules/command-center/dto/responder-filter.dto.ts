import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatusEnum } from '../../auth/enums/account-status.enum';
import { AgencyTypeEnum } from '../../responders/enums/agency-type.enum';
import { AvailabilityStatusEnum } from '../../responders/enums/availability-status.enum';

/**
 * Accepts `?status=active&status=deactivated` OR `?status=active,deactivated`.
 *
 * Anything that isn't a string or array (e.g. an object from a malformed
 * request) is passed through unchanged so downstream @IsEnum validators
 * reject it with a proper 400, instead of silently stringifying to
 * "[object Object]" and matching nothing.
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

/**
 * `'true'` / `'1'` → true; `'false'` / `'0'` → false; anything else passes
 * through unchanged so `@IsBoolean` fails on garbage.
 */
function toBool(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const v = value.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return value;
}

export class ResponderFilterDTO {
  @ApiPropertyOptional({
    enum: AccountStatusEnum,
    isArray: true,
    description: 'Match any of these account statuses',
  })
  @Transform(({ value }) => toArray(value))
  @IsOptional()
  @IsEnum(AccountStatusEnum, { each: true })
  status?: AccountStatusEnum[];

  @ApiPropertyOptional({
    enum: AvailabilityStatusEnum,
    isArray: true,
    description: 'Match any of these availability states',
  })
  @Transform(({ value }) => toArray(value))
  @IsOptional()
  @IsEnum(AvailabilityStatusEnum, { each: true })
  availability?: AvailabilityStatusEnum[];

  @ApiPropertyOptional({
    enum: AgencyTypeEnum,
    isArray: true,
    description: 'Match any of these agencies',
  })
  @Transform(({ value }) => toArray(value))
  @IsOptional()
  @IsEnum(AgencyTypeEnum, { each: true })
  agency?: AgencyTypeEnum[];

  @ApiPropertyOptional({
    description: 'Substring match (case-insensitive) over name and email',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive lower bound on user_account.created_at. ' +
      'ISO 8601; date-only means 00:00:00.000Z of that day.',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  createdFrom?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive upper bound on user_account.created_at. ' +
      'ISO 8601; date-only means 23:59:59.999Z of that day.',
    example: '2026-10-23',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on updated_at' })
  @IsOptional()
  @IsISO8601({ strict: false })
  updatedFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on updated_at' })
  @IsOptional()
  @IsISO8601({ strict: false })
  updatedTo?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on r_profile.last_active_at',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  lastActiveFrom?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on r_profile.last_active_at',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  lastActiveTo?: string;

  @ApiPropertyOptional({
    description:
      'true → currently on duty with a non-expired shift_ends_at; ' +
      'false → the inverse (includes off-duty and expired shifts)',
  })
  @Transform(({ value }) => toBool(value))
  @IsOptional()
  @IsBoolean()
  onShift?: boolean;

  @ApiPropertyOptional({
    description:
      'When true, include soft-deleted (deactivated) responders. ' +
      'Combine with status=deactivated to find accounts to reactivate.',
    default: false,
  })
  @Transform(({ value }) => toBool(value))
  @IsOptional()
  @IsBoolean()
  includeSoftDeleted?: boolean;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Opaque cursor from the previous page',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
