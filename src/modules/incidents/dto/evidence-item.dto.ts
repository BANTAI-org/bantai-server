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

/**
 * One evidence item. Mirrors is_valid_incident_evidence() (migration 008):
 * an item needs a non-blank "key" (R2 object key) and/or a non-blank "url".
 */
export class IncidentEvidenceItemDto {
  // Dummy property used solely to trigger class-level validation
  @Validate(HasKeyOrUrlConstraint)
  readonly _hasKeyOrUrl?: never;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'key must not be blank' })
  @MaxByteLength(1024) // S3/R2 key limit
  @Matches(/^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)/, {
    message: 'key must be an object key: no URL scheme and no leading slash',
  })
  key?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'url must not be blank' })
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  view?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  content_type?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size_bytes?: number;

  @IsOptional()
  @IsDateString()
  uploaded_at?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  duration_s?: number;
}
