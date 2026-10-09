import { IsNotEmpty, IsString } from 'class-validator';

export class UserIdDTO {
  @IsString()
  @IsNotEmpty()
  id!: string;
}
