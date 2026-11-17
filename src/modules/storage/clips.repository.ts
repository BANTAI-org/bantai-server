import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  CURSOR_COLUMN,
  CursorPage,
  PageOptions,
  clampLimit,
  cursorTsSql,
  keysetPredicate,
  queryRows,
  toPage,
} from '../../common/utils/cursor-pagination-helper.util';
import { ClipCountResponse, ClipGroup, ClipItem } from './interfaces/clips.types';

interface ClipGroupRow extends Record<string, unknown> {
  incident_id: string;
  captured_at: Date;
  trigger_source: string;
  threat_type: string;
  severity: string;
  incident_status: string;
  evidence: unknown;
  cursor_t: string;
}

function toClipItems(evidence: unknown): ClipItem[] {
  if (!Array.isArray(evidence)) return [];
  const out: ClipItem[] = [];
  for (const item of evidence) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.key !== 'string' || rec.key.trim() === '') continue;
    out.push({
      key: rec.key,
      view: typeof rec.view === 'string' ? rec.view : null,
      type: typeof rec.type === 'string' ? rec.type : null,
      content_type:
        typeof rec.content_type === 'string' ? rec.content_type : null,
      size_bytes: typeof rec.size_bytes === 'number' ? rec.size_bytes : null,
    });
  }
  return out;
}

@Injectable()
export class ClipsRepository {
  constructor(private readonly db: DatabaseService) {}

  async countClips(driverId: string): Promise<ClipCountResponse> {
    const [row] = await queryRows<{
      total_clips: number;
      total_incidents: number;
    }>(
      this.db,
      `SELECT
         COUNT(*)::int AS total_clips,
         COUNT(DISTINCT i.id)::int AS total_incidents
       FROM incident i
       CROSS JOIN LATERAL jsonb_array_elements(i.evidence) AS e(item)
       WHERE i.driver_id = $1::uuid
         AND e.item ? 'key'`,
      [driverId],
    );
    return {
      total_clips: row?.total_clips ?? 0,
      total_incidents: row?.total_incidents ?? 0,
    };
  }

  async findClips(
    driverId: string,
    { limit, cursor }: PageOptions = {},
  ): Promise<CursorPage<ClipGroup>> {
    const size = clampLimit(limit);
    const params: unknown[] = [driverId];
    const keyset = keysetPredicate(cursor, params, 'i.created_at', 'i.id', '<');
    params.push(size + 1);

    const rows = await queryRows<ClipGroupRow>(
      this.db,
      `SELECT
         i.id AS incident_id,
         i.created_at AS captured_at,
         i.trigger_source,
         i.threat_type,
         i.severity,
         i.status AS incident_status,
         i.evidence,
         ${cursorTsSql('i.created_at')} AS ${CURSOR_COLUMN}
       FROM incident i
       WHERE i.driver_id = $1::uuid
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(i.evidence) AS e(item)
           WHERE e.item ? 'key'
         )
         ${keyset}
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT $${params.length}`,
      params,
    );

    const page = toPage(rows, size, (r) => ({
      t: r.cursor_t,
      id: r.incident_id,
    }));

    return {
      items: page.items.map((row) => ({
        incident_id: row.incident_id,
        captured_at: row.captured_at.toISOString(),
        trigger_source: row.trigger_source,
        threat_type: row.threat_type,
        severity: row.severity,
        incident_status: row.incident_status,
        clips: toClipItems(row.evidence),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
