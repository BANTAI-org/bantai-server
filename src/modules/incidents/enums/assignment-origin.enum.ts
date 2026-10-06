/** assignment_origin_enum. Who put a responder on the incident. */
export enum AssignmentOriginEnum {
  WAVE_OFFER = 'WAVE_OFFER',
  CENTER_ASSIGNED = 'CENTER_ASSIGNED',
}

/**
 * assignment_status_enum. Per-responder view. OFFERED ends in
 * DECLINED, EXPIRED, LOST_RACE or CLAIMED; the single CLAIMED
 * responder then walks EN_ROUTE -> ARRIVED, or leaves via STOOD_DOWN.
 */
export enum AssignmentStatusEnum {
  OFFERED = 'OFFERED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  LOST_RACE = 'LOST_RACE',
  CLAIMED = 'CLAIMED',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVED = 'ARRIVED',
  STOOD_DOWN = 'STOOD_DOWN',
}
