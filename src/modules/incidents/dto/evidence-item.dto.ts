import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MaxByteLength } from '../utils/max-byte-lenght.util';
/**
 * One evidence item. Mirrors is_valid_incident_evidence() (migration 008):
 * an item needs a non-blank "key" (R2 object key) and/or a non-blank "url".
 * Prefer "key" for R2 objects; "url" is for evidence hosted elsewhere.
 * Every other field is free-form metadata the database does not check.
 */
export class IncidentEvidenceItemDto {
  // Required unless a url is supplied instead; if present it is always checked.
  @ValidateIf(
    (o: IncidentEvidenceItemDto) => o.url === undefined || o.key !== undefined,
  )
  @IsString()
  @Matches(/\S/, { message: 'key must not be blank' })
  @MaxByteLength(1024) // S3/R2 key limit
  @Matches(/^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)/, {
    message: 'key must be an object key: no URL scheme and no leading slash',
  })
  key?: string;

  @ValidateIf(
    (o: IncidentEvidenceItemDto) => o.key === undefined || o.url !== undefined,
  )
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
