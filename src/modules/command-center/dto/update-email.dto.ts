import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateResponderEmailDTO {
  @ApiProperty({
    description: 'New responder email address',
    example: 'responder@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
