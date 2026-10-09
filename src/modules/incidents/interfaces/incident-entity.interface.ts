import { TriggerSource } from '../enums/trigger-source.enum';
import { IncidentEvidenceItem } from '../types/evidence-item.type';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { IncidentOutcome } from '../enums/incident-outcome.enum';
import { GeoPoint } from '../../../common/interfaces/geo-location.interface';
export interface IncidentEntity {
  id: string;

  /** NULL only for CENTER_MANUAL incidents (walk-in report, rider not registered). */
  driver_id: string | null;
  device_id: string | null;
  location: GeoPoint;

  trigger_source: TriggerSource;
  /** Raw label from the edge model (free text, max 50 chars). */
  detected_class: string | null;
  /** 0..1. Required for EDGE_AI, NULL for human-raised incidents. */
  confidence_level: number | null;

  /** Evidence references (R2 keys / URLs). `[]` when there is none. */
  evidence: IncidentEvidenceItem[];

  threat_category: ThreatCategory;
  /** Defaults to ACTIVE_THREAT. */
  threat_level: ThreatLevel;
  /** Defaults to OTHER. GUN/BLADE require threat_category HAZARD. */
  threat_type: ThreatType;
  /** Defaults to UNKNOWN (dispatch treats it as SERIOUS until assessed). */
  severity: IncidentSeverity;
  /** Defaults to DETECTED. */
  status: IncidentStatus;
  /** Defaults to UNRESOLVED. */
  outcome: IncidentOutcome;

  /** claimed_by_id and claimed_at are always both set or both NULL. */
  claimed_by_id: string | null;
  claimed_at: Date | null;

  // Lifecycle stamps, maintained by the incident_lifecycle_guard trigger.
  dispatched_at: Date | null;
  on_scene_at: Date | null;
  escalated_at: Date | null;
  resolved_at: Date | null;
  cancelled_at: Date | null;
  resolved_by_id: string | null;

  // Independent (four-eyes) verification of the scene outcome.
  verified_by_id: string | null;
  verified_at: Date | null;
  verification_notes: string | null;

  created_at: Date;
  updated_at: Date;
}
