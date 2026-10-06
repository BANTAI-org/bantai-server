// TypeScript mirrors of the incident-related Postgres enums. The string
// VALUES must match the database exactly, including case (the dispatch
// enums are UPPER_CASE, the report/outcome ones lower_case). Each
// comment names the Postgres type it mirrors.

/** outcome_enum. Stays 'unresolved' until the incident is RESOLVED. */
export enum IncidentOutcomeEnum {
  CONFIRMED = 'confirmed',
  FALSE_POSITIVE = 'false_positive',
  UNRESOLVED = 'unresolved',
}
