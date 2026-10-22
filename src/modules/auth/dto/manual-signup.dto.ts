import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ManualSignupDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'SecurePass123!',
    description:
      'Password (10-128 chars, 1 uppercase, 1 number, 1 special char)',
  })
  @IsString()
  @Length(10, 128, {
    message: 'Password must be between 10 and 128 characters.',
  })
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).*$/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 number, and 1 special character.',
  })
  password!: string;
}
