import { Matches, MaxLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../util/password-policty';

export class ResetPasswordDto {
  @Matches(/^[a-f0-9]{64}$/, { message: 'reset_token is invalid' })
  reset_token!: string;

  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  new_password!: string;
}
