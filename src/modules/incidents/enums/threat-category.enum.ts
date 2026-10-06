/**
 * threat_category_enum. Static, set at detection. Governs who may
 * close the incident: ASSIST autonomously, DE_ESCALATABLE once the
 * scene is no longer an active threat, HAZARD never without
 * verification by someone other than the claimant.
 */
export enum ThreatCategoryEnum {
  ASSIST = 'ASSIST',
  DE_ESCALATABLE = 'DE_ESCALATABLE',
  HAZARD = 'HAZARD',
}
