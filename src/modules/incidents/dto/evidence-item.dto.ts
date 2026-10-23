import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Validate,
} from 'class-validator';
import { MaxByteLength } from '../utils/max-byte-lenght.util';
import { HasKeyOrUrlConstraint } from '../validators/has-key-or-url-constraint.validator';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

/**
 * One evidence item. Mirrors is_valid_incident_evidence() (migration 008):
 * an item needs a non-blank "key" (R2 object key) and/or a non-blank "url".
 */
export class IncidentEvidenceItemDto {
  // Dummy property used solely to trigger class-level validation
  @ApiHideProperty()
  @Validate(HasKeyOrUrlConstraint)
  readonly _hasKeyOrUrl?: never;

  @ApiProperty({
    required: false,
    description: 'R2 object key for the evidence file',
    example: 'incidents/123/evidence/photo.jpg',
  })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'key must not be blank' })
  @MaxByteLength(1024) // S3/R2 key limit
  @Matches(/^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)/, {
    message: 'key must be an object key: no URL scheme and no leading slash',
  })
  key?: string;

  @ApiProperty({
    required: false,
    description: 'Public or signed URL for the evidence file',
    example: 'https://storage.example.com/evidence/photo.jpg',
  })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'url must not be blank' })
  @MaxLength(2048)
  url?: string;

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
    example: 'photo',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @ApiProperty({
    required: false,
    description: 'Evidence MIME type',
    example: 'image/jpeg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  content_type?: string;

  @ApiProperty({
    required: false,
    description: 'Evidence file size in bytes',
    example: 248320,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  size_bytes?: number;

  @ApiProperty({
    required: false,
    description: 'Evidence upload timestamp in ISO 8601 format',
    example: '2026-10-23T01:30:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  uploaded_at?: string;

  @ApiProperty({
    required: false,
    description: 'Media duration in seconds',
    example: 18.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  duration_s?: number;
}
