import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleSsoDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIs...',
    description: 'Google ID token from client-side sign-in',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
