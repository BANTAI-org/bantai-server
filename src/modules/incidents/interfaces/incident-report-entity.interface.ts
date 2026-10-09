import { IncidentDisposition } from '../enums/incident-disposition.enum';
import { IncidentEvidenceItem } from '../types/evidence-item.type';
import { ReportStatus } from '../enums/report-status.enum';
export interface IncidentReportEntity {
  id: string;
  /** Unique per (incident_id, command_center_id). */
  incident_id: string;
  command_center_id: string;
  assigned_reporter_id: string | null;
  submitted_by_id: string | null;
  /** Required once status is past DRAFT. */
  disposition: IncidentDisposition | null;
  summary: string;
  detailed_narrative: string | null;
  /**
   * JSONB array. The database only enforces that it is an array; the item shape
   * is not constrained. Plain URL strings and IncidentEvidenceItem objects are
   * both possible, so narrow before use.
   */
  evidence_urls: Array<string | IncidentEvidenceItem>;
  /** Defaults to DRAFT. */
  status: ReportStatus;
  /** Set (with reviewed_at) only for NEEDS_REVISION / APPROVED; never the submitter. */
  reviewed_by: string | null;
  /** Required when status is NEEDS_REVISION. */
  reviewer_notes: string | null;
  reviewed_at: Date | null;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
