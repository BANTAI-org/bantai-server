import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class PasswordResetIdentityDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number?: string;
}
