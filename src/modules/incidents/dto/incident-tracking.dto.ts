import { IncidentStatus } from '../enums/incident-status.enum';

/**
 * The shape returned by GET /incidents/:id/tracking AND pushed over
 * the `incident.tracking_updated` socket event. Identical, so the
 * client has one render path whether it's polling or streaming.
 */
export interface IncidentTrackingDto {
  incident_id: string;
  status: IncidentStatus;

  /** Null until someone claims. */
  responder_id: string | null;

  /** "Maria Santos" — null until claim. */
  responder_name: string | null;

  /** Straight-line, metres. Null if responder GPS is stale / missing. */
  distance_meters: number | null;

  /** Seconds. Null if distance is null. */
  eta_seconds: number | null;

  /** ISO of the last GPS fix used. Null if none. */
  last_seen_at: string | null;

  /** True when a fresh fix (< 90 s old) backed the distance/ETA. */
  is_live: boolean;

  /** Server time when this snapshot was computed. */
  computed_at: string;
}
