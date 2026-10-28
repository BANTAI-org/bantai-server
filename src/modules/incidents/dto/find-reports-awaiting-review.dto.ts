import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { ApiProperty } from '@nestjs/swagger';
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

/**
 * Cursor queue for the review dashboard. Kept alongside the offset list
 * because they serve different UIs: this one is "review the next one, then
 * the next", the offset one is "browse page 2 of 12".
 */
export class FindReportsAwaitingReviewQueryDto extends PageQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  command_center_id?: string;

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
