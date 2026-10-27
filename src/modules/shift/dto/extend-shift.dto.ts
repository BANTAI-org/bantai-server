import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ExtendShiftDto {
  @ApiProperty({
    description:
      'Minutes to add to the current shift_ends_at. Clamped so an already-expired shift starts counting from now.',
    example: 60,
    minimum: 1,
    maximum: 720,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  minutes!: number;
}
