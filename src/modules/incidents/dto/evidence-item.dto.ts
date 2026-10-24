import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MaxByteLength } from '../utils/max-byte-lenght.util';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One evidence item. Server stores only R2 key + metadata enriched from R2.
 * Client supplies only key, view, and type.
 */
export class IncidentEvidenceItemDto {
  @ApiProperty({
    description: 'R2 object key for the evidence file',
    example: 'incidents/123/evidence/photo.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @MaxByteLength(1024)
  @Matches(/^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)/, {
    message: 'key must be an object key: no URL scheme and no leading slash',
  })
  key!: string;

  @ApiProperty({
    required: false,
    description: 'Evidence camera or image view',
    example: 'front',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  view?: string;

  @ApiProperty({
    required: false,
    description: 'Evidence media type',
    example: 'video',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;
}
