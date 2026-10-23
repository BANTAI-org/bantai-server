import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateLocationDto {
  // Redis GEO rejects latitudes beyond +-85.05112878, so validate to 85
  // here to get a clean 400 instead of a 500 from Redis.
  @ApiProperty({ description: 'GPS latitude in degrees', example: 14.676 })
  @IsNumber()
  @Min(-85)
  @Max(85)
  latitude!: number;

  @ApiProperty({ description: 'GPS longitude in degrees', example: 121.0437 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  /** Reported GPS accuracy radius in meters, if the device provides it. */
  @ApiProperty({
    required: false,
    description: 'Reported horizontal GPS accuracy in meters',
    example: 8.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracy_meters?: number;
}
