/** Postgres: threat_level_enum. Defaults to ACTIVE_THREAT ("assume danger"). */
export enum ThreatLevel {
  ACTIVE_THREAT = 'ACTIVE_THREAT',
  DE_ESCALATED = 'DE_ESCALATED',
  CLEAR = 'CLEAR',
}
