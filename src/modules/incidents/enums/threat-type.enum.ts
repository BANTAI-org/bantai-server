/**
 * Postgres: threat_type_enum
 * WHAT was detected: the canonical type the system acts on, mapped once in code
 * from the raw detected_class label. GUN/BLADE force threat_category = HAZARD;
 * CONFRONTATION can't be ASSIST (both enforced by CHECK constraints).
 */
export enum ThreatType {
  GUN = 'GUN',
  BLADE = 'BLADE',
  CONFRONTATION = 'CONFRONTATION',
  COLLISION = 'COLLISION',
  PERSON_DOWN = 'PERSON_DOWN',
  OTHER = 'OTHER',
}
