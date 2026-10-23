import { IsOptional, IsDateString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PatchResponderProfileDto {
  @ApiProperty({
    required: false,
    description: 'Updated Philippine mobile number in E.164 format',
    example: '+639171234567',
  })
  @IsOptional()
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number?: string;

  @ApiProperty({
    required: false,
    description: 'Phone verification timestamp in ISO 8601 format',
    example: '2026-10-23T01:30:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  phone_verified_at?: string;
}
