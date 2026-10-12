import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { ReportStatus } from '../enums/report-status.enum';

/** 1:1 with the incident_report table. */
export interface IncidentReportEntity {
  id: string;
  /** One report per (incident, command_center_id). */
  incident_id: string;
  /** The reporting responder's home command center, set at creation. */
  command_center_id: string;

  assigned_reporter_id: string | null;
  submitted_by_id: string | null;

  /** Required once status is anything other than 'draft'. */
  disposition: IncidentDisposition | null;
  summary: string;
  detailed_narrative: string | null;
  evidence_urls: string[];
  status: ReportStatus;

  /**
   * Set only for 'needs_revision' and 'approved'; must be NULL for
   * draft / submitted / under_review. reviewed_by can never equal
   * submitted_by_id. reviewer_notes is required for 'needs_revision'.
   */
  reviewed_by: string | null;
  reviewer_notes: string | null;
  reviewed_at: Date | null;

  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
