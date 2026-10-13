import { Matches } from 'class-validator';
import { PasswordResetIdentityDto } from './password-reset-identity.dto';

export class VerifyOtpDto extends PasswordResetIdentityDto {
  @Matches(/^\d{6}$/, { message: 'otp_code must be a 6-digit code' })
  otp_code!: string;
}
