import { ApiProperty } from '@nestjs/swagger';

export class DistanceSessionDto {
  @ApiProperty({ example: 38400 })
  distance_meters!: number;

  @ApiProperty({ example: '2026-11-17T08:00:00.000Z' })
  started_at!: string;
}

export class DistanceLastShiftDto {
  @ApiProperty({ example: 12500 })
  distance_meters!: number;

  @ApiProperty({ example: '2026-11-16T08:00:00.000Z' })
  started_at!: string;

  @ApiProperty({ example: '2026-11-16T16:00:00.000Z' })
  ended_at!: string;
}

export class DistanceSnapshotDto {
  @ApiProperty({ enum: ['on_duty', 'off_duty'] })
  duty_status!: string;

  @ApiProperty({ type: DistanceSessionDto, nullable: true })
  session!: DistanceSessionDto | null;

  @ApiProperty({ type: DistanceLastShiftDto, nullable: true })
  last_shift!: DistanceLastShiftDto | null;
}
