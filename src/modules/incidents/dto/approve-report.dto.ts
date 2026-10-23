import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimToNull } from '../utils/trim-transform.util';
import { ApiProperty } from '@nestjs/swagger';

export class ApproveReportDto {
  @ApiProperty({
    required: false,
    description: 'Optional reviewer approval notes',
    example: 'Report reviewed and approved.',
  })
  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
