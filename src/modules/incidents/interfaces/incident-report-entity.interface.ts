import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { ReportStatus } from '../enums/report-status.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { TriggerSource } from '../enums/trigger-source.enum';

/**
 * Incident report + its incident context, with server-derived booleans the
 * Flutter UI uses to render status pills without re-deriving workflow rules.
 *
 * The `incident_*` fields come from a JOIN on `incident` — they are always
 * present on entity responses because every report has a parent incident
 * (FK NOT NULL). The `is_*` and `needs_*` booleans are computed in the
 * repository after each read; never trust a client-side derivation of these
 * for gating actions (the server re-checks).
 */
export interface IncidentReportEntity {
  id: string;
  incident_id: string;
  command_center_id: string;
  assigned_reporter_id: string | null;
  submitted_by_id: string | null;
  disposition: IncidentDisposition | null;
  summary: string;
  detailed_narrative: string | null;
  evidence_urls: string[];
  status: ReportStatus;
  reviewed_by: string | null;
  reviewer_notes: string | null;
  reviewed_at: Date | null;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;

  // Incident context (from JOIN incident)
  incident_status: IncidentStatus;
  incident_threat_category: ThreatCategory;
  incident_threat_level: ThreatLevel;
  incident_verified_at: Date | null;
  incident_verified_by_id: string | null;
  incident_trigger_source: TriggerSource;
  incident_claimed_by_id: string | null;
  incident_claimed_by_name: string | null;

  // Report-state pills
  is_report_draft: boolean;
  is_report_pending_review: boolean;
  is_report_approved: boolean;
  is_report_rejected: boolean;
  is_report_final: boolean;

  // Incident-state pills
  is_incident_verified: boolean;
  is_incident_resolved: boolean;
  is_incident_cancelled: boolean;
  is_incident_pending_verification: boolean;

  /**
   * True only when the CC admin must click "Verify incident" before the
   * safety gate (chck_incident_resolution_safety_gate) allows RESOLVED:
   * AWAITING_VERIFICATION + not yet verified + (HAZARD, or DE_ESCALATABLE
   * still at ACTIVE_THREAT). Mirrors the safety gate exactly — if you
   * change the gate, change this too.
   */
  needs_incident_verification: boolean;
}
