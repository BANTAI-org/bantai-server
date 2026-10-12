import { IsOptional, IsDateString, Matches } from 'class-validator';

export class PatchResponderProfileDto {
  @IsOptional()
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number?: string;

  @IsOptional()
  @IsDateString()
  phone_verified_at?: string;
}
