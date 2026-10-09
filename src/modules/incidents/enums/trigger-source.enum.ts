/** Postgres: trigger_source_enum */
export enum TriggerSource {
  /** Raised by the dashcam's on-device model (requires confidence_level). */
  EDGE_AI = 'EDGE_AI',
  /** Rider pressed SOS in the app. No camera, so no clips. */
  MANUAL_SOS = 'MANUAL_SOS',
  /** Walk-in / phone report entered by a command center (driver_id may be NULL). */
  CENTER_MANUAL = 'CENTER_MANUAL',
}
