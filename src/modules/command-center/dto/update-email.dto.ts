import { IsEmail, IsNotEmpty } from 'class-validator';

export class UpdateResponderEmailDTO {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
