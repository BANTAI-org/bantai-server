import { Matches, MaxLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../util/password-policty';

export class UpdateDriverPasswordDto {
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  new_password!: string;
}
