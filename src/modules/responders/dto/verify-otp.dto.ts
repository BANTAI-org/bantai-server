import {
  IsString,
  IsNotEmpty,
  Length,
  IsOptional,
  Matches,
} from 'class-validator';

export class VerifyOtpDto {
  @IsOptional()
  @IsString()
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number?: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP code must be 6 digits' })
  otp_code!: string;
}
