import { TriggerSource } from '../enums/trigger-source.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { IncidentOutcome } from '../enums/incident-outcome.enum';
import { AgencyTypeEnum } from '../../responders/enums/agency-type.enum';
import { EscalationReason } from '../enums/escalation-reason.enum';
import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { ReportStatus } from '../enums/report-status.enum';

export interface IncidentLogEntity {
  incident_id: string | null;

  trigger_source: TriggerSource | null;
  detected_class: string | null;
  confidence_level: number | null;
  threat_category: ThreatCategory | null;
  threat_level: ThreatLevel | null;
  status: IncidentStatus | null;
  outcome: IncidentOutcome | null;

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
  detected_at: Date | null;
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
