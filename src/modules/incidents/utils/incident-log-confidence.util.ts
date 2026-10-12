import { IncidentLogEntity } from '../interfaces/incident-log-entity.interface';

const toNumber = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export function toIncidentLog(row: Record<string, unknown>): IncidentLogEntity {
  return {
    ...row,
    confidence_level: toNumber(row.confidence_level),
    time_to_claim_seconds: toNumber(row.time_to_claim_seconds),
    time_to_scene_seconds: toNumber(row.time_to_scene_seconds),
    time_to_resolution_seconds: toNumber(row.time_to_resolution_seconds),
  } as unknown as IncidentLogEntity;
}
