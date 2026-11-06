import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { ReportStatus } from '../enums/report-status.enum';
import { IncidentStatus } from '../enums/incident-status.enum';
import { ThreatCategory } from '../enums/threat-category.enum';
import { ThreatLevel } from '../enums/threat-level.enum';
import { TriggerSource } from '../enums/trigger-source.enum';

/**
 * Incident report + its incident context, with server-derived booleans the
 * Flutter UI uses to render status pills without re-deriving workflow rules.
 */
export interface IncidentReportEntity {
  id: string;
  incident_id: string;
  command_center_id: string;
  assigned_reporter_id: string | null;
  submitted_by_id: string | null;
  reviewed_by: string | null;

  // 🚨 NEW: Resolved Names for UI display 🚨
  command_center_name: string | null;
  assigned_reporter_name: string | null;
  submitted_by_name: string | null;
  reviewed_by_name: string | null;

  disposition: IncidentDisposition | null;
  summary: string;
  detailed_narrative: string | null;
  evidence_urls: string[];
  status: ReportStatus;
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

  needs_incident_verification: boolean;
}
