/** Postgres: outcome_enum. A RESOLVED incident must not be 'unresolved'. */
export enum IncidentOutcome {
  CONFIRMED = 'confirmed',
  FALSE_POSITIVE = 'false_positive',
  UNRESOLVED = 'unresolved',
}
