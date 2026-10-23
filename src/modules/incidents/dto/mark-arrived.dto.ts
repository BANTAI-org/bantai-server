import { IsEnum } from 'class-validator';
import { ArrivalConfirmationMethod } from '../enums/arrival-confirmation-method.enum';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Body for markArrived. The responder id and `confirmedById` are NOT client
 * fields: take the responder from the auth token, and for method 'manual' set
 * confirmedById to the authenticated user doing the confirming (null for 'gps').
 * Letting the client name who confirmed them would be spoofable.
 */
export class MarkArrivedDto {
  @ApiProperty({
    enum: ArrivalConfirmationMethod,
    description: 'How arrival was confirmed',
    example: ArrivalConfirmationMethod.MANUAL,
  })
  @IsEnum(ArrivalConfirmationMethod)
  method!: ArrivalConfirmationMethod;
}
