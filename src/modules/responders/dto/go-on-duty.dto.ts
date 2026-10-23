import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoOnDutyDto {
  /**
   * How long this shift should last before it ends automatically.
   * Optional: when omitted the server uses a 12 h default, so there is
   * always an end time.
   */
  @ApiProperty({
    required: false,
    description: 'Duty shift duration in minutes; defaults to 720 minutes',
    example: 480,
  })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  duration_minutes?: number;
}
