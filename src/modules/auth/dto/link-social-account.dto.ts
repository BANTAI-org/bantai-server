import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AuthProviderEnum } from '../../responders/enums/auth-provider.enum';

export class LinkSocialAccountDto {
  @ApiProperty({
    enum: AuthProviderEnum,
    example: AuthProviderEnum.GOOGLE,
    description: 'OAuth provider',
  })
  @IsEnum(AuthProviderEnum)
  @IsNotEmpty()
  provider!: AuthProviderEnum;

  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIs...',
    description: 'Provider ID token',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
