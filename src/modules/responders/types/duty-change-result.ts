import { AvailabilityStatusEnum } from '../enums/availability-status.enum';

export type DutyChangeResult =
  | { status: 'UPDATED'; distance_meters: number }
  | { status: 'NOT_FOUND' }
  | { status: 'OUT_OF_RANGE'; distance_meters: number }
  | { status: 'INVALID_STATE'; availability: AvailabilityStatusEnum };
