import { SendOtpDto } from './send-otp.dto';
import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto extends SendOtpDto {
  @ApiProperty({
    description: 'Six-digit one-time password sent by SMS',
    example: '123456',
  })
  @Matches(/^\d{6}$/, { message: 'otp_code must be a 6-digit code' })
  otp_code!: string;
}
