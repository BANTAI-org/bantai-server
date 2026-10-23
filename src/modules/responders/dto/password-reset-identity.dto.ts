import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetIdentityDto {
  @ApiProperty({
    required: false,
    description: 'Responder user UUID',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    required: false,
    description: 'Account email address',
    example: 'responder@example.com',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @ApiProperty({
    required: false,
    description: 'Philippine mobile number in E.164 format',
    example: '+639171234567',
  })
  @IsOptional()
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number?: string;
}
