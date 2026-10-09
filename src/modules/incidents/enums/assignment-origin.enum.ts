/** Postgres: assignment_origin_enum */
export enum AssignmentOrigin {
  /** Offered by a radial dispatch wave (wave_id and distance_meters required). */
  WAVE_OFFER = 'WAVE_OFFER',
  /** Assigned directly by a command center (assigned_by_id required, no wave). */
  CENTER_ASSIGNED = 'CENTER_ASSIGNED',
}
