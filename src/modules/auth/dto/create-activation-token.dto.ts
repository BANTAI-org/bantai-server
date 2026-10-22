import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AccountTokenPurposeEnum } from '../enums/account-token-purpose.enum';

export class createActivationTokenDTO {
  @ApiProperty({ example: 'uuid-user-id', description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  user_id!: string;

  @ApiProperty({
    enum: AccountTokenPurposeEnum,
    example: AccountTokenPurposeEnum.ACTIVATION,
    description: 'Token purpose',
  })
  @IsEnum(AccountTokenPurposeEnum)
  @IsNotEmpty()
  purpose!: AccountTokenPurposeEnum;

  @ApiProperty({ example: 'sha256hash...', description: 'Hashed token' })
  @IsString()
  @IsNotEmpty()
  token_hash!: string;
}
