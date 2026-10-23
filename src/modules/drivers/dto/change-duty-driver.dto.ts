import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { DutyStatusEnum } from '../enums/duty-status.enum';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeDutyDto {
  @ApiProperty({
    enum: DutyStatusEnum,
    description: 'Driver duty status',
    example: DutyStatusEnum.ON_DUTY,
  })
  @IsEnum(DutyStatusEnum)
  duty_status!: DutyStatusEnum;

  // Required only when going on duty; ignored when going off.
  @ApiProperty({
    required: false,
    description: 'Shift duration in hours, required when going on duty',
    example: 8,
  })
  @ValidateIf((o: ChangeDutyDto) => o.duty_status === DutyStatusEnum.ON_DUTY)
  @IsInt()
  @Min(1)
  @Max(18)
  shift_hours?: number;
}
