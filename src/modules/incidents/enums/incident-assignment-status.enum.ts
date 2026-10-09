/** Postgres: assignment_status_enum */
export enum AssignmentStatus {
  OFFERED = 'OFFERED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  /** Another responder won the claim. */
  LOST_RACE = 'LOST_RACE',
  CLAIMED = 'CLAIMED',
  EN_ROUTE = 'EN_ROUTE',
  ARRIVED = 'ARRIVED',
  STOOD_DOWN = 'STOOD_DOWN',
}
