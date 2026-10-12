import { IncidentDisposition } from '../../../enums/incident-disposition.enum';
export interface CreateReportData {
  incident_id: string;
  /**
   * The responder writing the report. Their home command center becomes the
   * report's owner (command_center_id); they become assigned_reporter_id.
   */
  reporter_id: string;
  summary: string;
  disposition?: IncidentDisposition | null;
  detailed_narrative?: string | null;
  evidence_urls?: string[];
  /**
   * 'draft' (default), or 'submitted' to file it in one step. Submitting
   * requires a disposition.
   */
  status?: 'draft' | 'submitted';
}

/**
 * Outcome of an admin/super review action.
 *  reviewed        done
 *  not_found       no such report
 *  forbidden       reviewer is not a super, nor an admin of the report's command center
 *  own_report      the reviewer is the one who submitted it
 *  not_reviewable  the report is not in a state this action applies to
 */
export type ReviewResult =
  'reviewed' | 'not_found' | 'forbidden' | 'own_report' | 'not_reviewable';

/**
 * Fields a reporter may edit while the report is a draft or needs revision.
 * Omit a key to leave it as is; send null to clear a nullable one.
 */
export interface UpdateReportDraftData {
  summary?: string;
  detailed_narrative?: string | null;
  disposition?: IncidentDisposition | null;
  evidence_urls?: string[];
}
