import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GoOnDutyDto {
  @ApiProperty({
    required: false,
    description: 'Duty shift duration in minutes; defaults to 720 minutes',
    example: 480,
  })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  @Type(() => Number)
  duration_minutes?: number;
}
