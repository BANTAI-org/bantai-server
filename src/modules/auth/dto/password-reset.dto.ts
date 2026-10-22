import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetDTO {
  @ApiProperty({ example: 'uuid-user-id', description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    example: 'NewSecurePass123!',
    description:
      'New password (10-128 chars, 1 uppercase, 1 number, 1 special char)',
  })
  @IsString()
  @Length(10, 128, {
    message: 'Password must be between 10 and 128 characters.',
  })
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).*$/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 number, and 1 special character.',
  })
  new_password!: string;
}
