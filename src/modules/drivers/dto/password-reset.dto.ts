import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../util/password-policty';
import { PasswordResetIdentityDto } from './password-reset-identity.dto';

/**
 * Step 3 of the wizard: everything in one request. The password is only
 * changed if the code checks out; any OTP problem leaves it untouched.
 * "Confirm password" is a client-side check and is not sent.
 */
export class ResetPasswordDto extends PasswordResetIdentityDto {
  @Matches(/^\d{6}$/, { message: 'otp_code must be a 6-digit code' })
  otp_code!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  new_password!: string;
}
