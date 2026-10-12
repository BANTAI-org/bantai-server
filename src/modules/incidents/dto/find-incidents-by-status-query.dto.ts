import { Transform } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { IncidentStatus } from '../enums/incident-status.enum';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
/**
 * Query for findIncidentsByStatus. Accepts a comma list
 * (?statuses=DETECTED,DISPATCHING) or a repeated param
 * (?statuses=DETECTED&statuses=DISPATCHING).
 */
export class FindIncidentsByStatusQueryDto extends PageQueryDto {
  @Transform(({ value }: { value: unknown }) => {
    // Only real strings are split. Anything else (undefined, an object from
    // ?statuses[a]=1, ...) is returned untouched so @IsArray / @IsEnum reject
    // it, instead of being stringified into "[object Object]".
    const parts: unknown[] | null = Array.isArray(value)
      ? (value as unknown[])
      : typeof value === 'string'
        ? value.split(',')
        : null;
    if (parts === null) return value;
    return parts
      .map((part) => (typeof part === 'string' ? part.trim() : part))
      .filter((part) => part !== '');
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(IncidentStatus, { each: true })
  statuses!: IncidentStatus[];
}
