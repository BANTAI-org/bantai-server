import { IncidentEvidenceItemDto } from '../dto/evidence-item.dto';
import { IncidentEvidenceItem } from '../types/evidence-item.type';

/** Maps a single evidence item DTO to the JSONB type.
 *
 * The DTO now only contains: key (required), view?, type?.
 * All other metadata (size_bytes, content_type, uploaded_at, duration_s, url)
 * is enriched server-side from R2 HeadObject after the incident is created.
 */
export function toIncidentEvidenceItem(
  dto: IncidentEvidenceItemDto,
): IncidentEvidenceItem {
  const { key, ...rest } = dto;
  // key is required; view and type passed through; other metadata server-enriched
  if (key === undefined || key === null) {
    throw new Error('evidence item missing required "key"');
  }
  return {
    key,
    // view and type passed through; all other metadata will be server-enriched
    ...rest,
  };
}

/** Maps CreateIncidentDto.evidence for CreateIncidentData; undefined stays undefined. */
export function toIncidentEvidenceItems(
  items: IncidentEvidenceItemDto[] | undefined,
): IncidentEvidenceItem[] | undefined {
  return items?.map(toIncidentEvidenceItem);
}
