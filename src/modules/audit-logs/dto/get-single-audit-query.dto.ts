import { IsOptional, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class GetSingleAuditQueryDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdAt?: Date;
}
