import { ApiProperty } from '@nestjs/swagger';

export class ShiftStatusDto {
  @ApiProperty({ enum: ['driver', 'responder'] })
  role!: 'driver' | 'responder';

  @ApiProperty({
    description: "on_duty for responders, duty_status = 'on_duty' for drivers",
  })
  on_duty!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'ISO timestamp when the current shift auto-ends',
  })
  shift_ends_at!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Seconds until shift_ends_at. Null when off duty or no timer. Clamped to 0 when already expired (between cron ticks).',
  })
  remaining_seconds!: number | null;
}
