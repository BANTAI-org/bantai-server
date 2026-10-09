/**
 * Postgres: threat_category_enum
 * "Is there an adversary?" Governs who may CLOSE the incident.
 */
export enum ThreatCategory {
  /** No adversary (e.g. a collision). A single responder may close it. */
  ASSIST = 'ASSIST',
  /** A confrontation that can be defused; closable without verification only once threat_level is DE_ESCALATED or CLEAR. */
  DE_ESCALATABLE = 'DE_ESCALATABLE',
  /** Armed / serious threat. Never closable by the claimant alone; must be verified by someone else. */
  HAZARD = 'HAZARD',
}
