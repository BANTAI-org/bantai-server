import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TrimToNull } from '../utils/trim-transform.util';

export class ApproveReportDto {
  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
