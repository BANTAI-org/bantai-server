import { IncidentEvidenceItemDto } from '../dto/evidence-item.dto';
import { IncidentEvidenceItem } from '../types/evidence-item.type';
export function toIncidentEvidenceItem(
  dto: IncidentEvidenceItemDto,
): IncidentEvidenceItem {
  const { key, url, ...rest } = dto;
  if (key !== undefined) {
    return url !== undefined ? { ...rest, key, url } : { ...rest, key };
  }
  if (url !== undefined) return { ...rest, url };
  throw new Error('evidence item has neither "key" nor "url"');
}

/** Maps CreateIncidentDto.evidence for CreateIncidentData; undefined stays undefined. */
export function toIncidentEvidenceItems(
  items: IncidentEvidenceItemDto[] | undefined,
): IncidentEvidenceItem[] | undefined {
  return items?.map(toIncidentEvidenceItem);
}
