import { TriggerSource } from '../enums/trigger-source.enum';
import { ThreatType } from '../enums/threat-type.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { IncidentOutcome } from '../enums/incident-outcome.enum';
import { AgencyTypeEnum } from '../../responders/enums/agency-type.enum';
import { EscalationReason } from '../enums/escalation-reason.enum';
import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { ReportStatus } from '../enums/report-status.enum';

/**
 * One row of the `incident_logs` view (rebuilt in migration 011).
 *
 * Field nullability reflects the view's actual guarantees:
 *   * Columns read straight off `incident` (or `incident` PK/FKs) are
 *     non-nullable here because their source columns are NOT NULL.
 *   * Columns sourced from LEFT JOINs (user_account, device, r_profile,
 *     incident_escalation, incident_report) are nullable.
 *   * Derived durations are nullable because their inputs (claimed_at,
 *     on_scene_at, resolved_at) are nullable lifecycle stamps.
 */
export interface IncidentLogEntity {
  incident_id: string;

  trigger_source: TriggerSource;
  threat_type: ThreatType;
  confidence_level: number | null;
  threat_category: ThreatCategory;
  threat_level: ThreatLevel;
  severity: IncidentSeverity;
  status: IncidentStatus;
  outcome: IncidentOutcome;

  driver_id: string | null;
  rider_name: string | null;
  rider_deleted_at: Date | null;
  hardware_serial: string | null;

  claimed_by_id: string | null;
  claimed_by_name: string | null;
  claimed_by_agency: AgencyTypeEnum | null;

  escalated_command_center_id: string | null;
  escalation_reason: EscalationReason | null;
  disposition: IncidentDisposition | null;
  report_status: ReportStatus | null;

  // Lifecycle timestamps (detected_at is incident.created_at).
  detected_at: Date;
  dispatched_at: Date | null;
  claimed_at: Date | null;
  on_scene_at: Date | null;
  escalated_at: Date | null;
  verified_at: Date | null;
  resolved_at: Date | null;
  cancelled_at: Date | null;

  // Derived durations, in seconds.
  time_to_claim_seconds: number | null;
  time_to_scene_seconds: number | null;
  time_to_resolution_seconds: number | null;
}
