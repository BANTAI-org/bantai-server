import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '../util/password-policty';

export class ChangePassAndIssueNewRefreshTokenDTO {
  @IsString()
  @IsNotEmpty()
  old_password!: string;

  @MaxLength(PASSWORD_MAX_LENGTH)
  @MinLength(PASSWORD_MIN_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  new_password!: string;
}
