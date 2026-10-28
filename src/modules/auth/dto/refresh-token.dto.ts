import { IsOptional, IsString } from 'class-validator';

export class RefreshDTO {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
