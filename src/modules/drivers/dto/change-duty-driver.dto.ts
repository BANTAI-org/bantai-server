import { IsEnum, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { DutyStatusEnum } from '../enums/duty-status.enum';

export class ChangeDutyDto {
  @IsEnum(DutyStatusEnum)
  duty_status!: DutyStatusEnum;

  // Required only when going on duty; ignored when going off.
  @ValidateIf((o: ChangeDutyDto) => o.duty_status === DutyStatusEnum.ON_DUTY)
  @IsInt()
  @Min(1)
  @Max(24)
  shift_hours?: number;
}
