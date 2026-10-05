import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateLocationDto {
  // Redis GEO rejects latitudes beyond +-85.05112878, so validate to 85
  // here to get a clean 400 instead of a 500 from Redis.
  @IsNumber()
  @Min(-85)
  @Max(85)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Reported GPS accuracy radius in meters, if the device provides it. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracy_meters?: number;
}
