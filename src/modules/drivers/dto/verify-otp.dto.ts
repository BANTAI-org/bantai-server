import { Matches } from 'class-validator';
import { PasswordResetIdentityDto } from './password-reset-identity.dto';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto extends PasswordResetIdentityDto {
  @ApiProperty({
    description: 'Six-digit one-time password',
    example: '123456',
  })
  @Matches(/^\d{6}$/, { message: 'otp_code must be a 6-digit code' })
  otp_code!: string;
}
