import { Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../util/password-policty';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Single-use password reset token',
    example: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
  @Matches(/^[a-f0-9]{64}$/, { message: 'reset_token is invalid' })
  reset_token!: string;

  @ApiProperty({
    description: 'New password meeting the configured password policy',
    example: 'StrongPass123!',
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @MinLength(PASSWORD_MIN_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  new_password!: string;
}
