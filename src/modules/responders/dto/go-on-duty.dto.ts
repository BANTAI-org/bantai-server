import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GoOnDutyDto {
  /**
   * How long this shift should last before it ends automatically.
   * Optional: when omitted the server uses a 12 h default, so there is
   * always an end time.
   */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  duration_minutes?: number;
}
