import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({
    description: 'Philippine mobile number in E.164 format',
    example: '+639171234567',
  })
  @Matches(/^\+639\d{9}$/, {
    message: 'm_number must be a valid PH mobile number (+639XXXXXXXXX)',
  })
  m_number!: string;
}
