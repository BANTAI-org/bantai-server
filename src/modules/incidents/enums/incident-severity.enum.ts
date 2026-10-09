/**
 * Postgres: incident_severity_enum
 * HOW BAD / how urgent. Independent of ThreatCategory.
 */
export enum IncidentSeverity {
  /** Not assessed yet (default). Dispatch should treat it as SERIOUS until assessed. */
  UNKNOWN = 'UNKNOWN',
  /** Rider is OK or lightly hurt, can walk and talk. */
  MINOR = 'MINOR',
  /** Injured; needs medical attention or transport. */
  SERIOUS = 'SERIOUS',
  /** Life-threatening: unresponsive, trapped or pinned, or fatal. */
  CRITICAL = 'CRITICAL',
}
