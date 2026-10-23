import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../utils/trim-transform.util';
import { ApiProperty } from '@nestjs/swagger';

export class RequestReportRevisionDto {
  @ApiProperty({
    description: 'Required explanation of requested revisions',
    example: 'Please include the responding unit and arrival time.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'notes are required when requesting a revision' })
  @MaxLength(2000)
  notes!: string;
}
