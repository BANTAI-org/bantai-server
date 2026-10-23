import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { Trim } from '../utils/trim-transform.util';
import { ApiProperty } from '@nestjs/swagger';
/**
 * Body for updateReportDraft (PATCH semantics). Omit a key to leave it as is.
 * null is allowed only where the column is nullable (detailed_narrative,
 * disposition); summary and evidence_urls cannot be cleared to null.
 *
 * An empty body is valid here but changes nothing: the repository returns
 * null for it, so the service should answer 400 "no fields to update".
 * Clearing disposition on a report that is no longer a draft fails in the
 * database (23514).
 */
export class UpdateReportDraftDto {
  @ApiProperty({
    required: false,
    description: 'Updated report summary',
    example: 'Updated summary of the response.',
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  summary?: string;

  @ApiProperty({
    required: false,
    description: 'Updated detailed narrative',
    example: 'The responder arrived at 14:35 and provided first aid.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  detailed_narrative?: string | null;

  @ApiProperty({
    required: false,
    enum: IncidentDisposition,
    description: 'Updated report disposition',
    example: IncidentDisposition.FALSE_ALARM,
  })
  @IsOptional()
  @IsEnum(IncidentDisposition)
  disposition?: IncidentDisposition | null;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Replacement list of evidence URLs or object keys',
    example: ['incidents/123/evidence/photo.jpg'],
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(2048, { each: true })
  evidence_urls?: string[];
}
