import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../utils/trim-transform.util';

export class RequestReportRevisionDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'notes are required when requesting a revision' })
  @MaxLength(2000)
  notes!: string;
}
