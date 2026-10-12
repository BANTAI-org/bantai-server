import { DatabaseService } from '../../database/database.service';
import { IncidentDisposition } from './enums/incident-disposition.enum';
import { IncidentReportEntity } from './interfaces/incident-report-entity.interface';
import {
  CreateReportData,
  ReviewResult,
  UpdateReportDraftData,
} from './types/datas/incident-report-datas/create-report-data.types';

import {
  CURSOR_COLUMN,
  CursorPage,
  PageOptions,
  clampLimit,
  cursorTsSql,
  keysetPredicate,
  queryRows as queryRowsOn,
  stripCursorColumn,
  toPage,
} from '../../common/utils/cursor-pagination-helper.util';

/**
 * Who may review a report: a super, or an admin of the report's own command
 * center. Expects the reviewer id as $2 and the report aliased as `r`.
 * (Policy assumption: change it here if admins may review across centers.)
 */
const REVIEWER_IS_AUTHORIZED = `
  EXISTS (
    SELECT 1 FROM user_account u
     WHERE u.id = $2::uuid
       AND u.deleted_at IS NULL
       AND (u.role = 'super'
            OR (u.role = 'admin' AND u.command_center_id = r.command_center_id))
  )`;

/** Row shape of the lookup that labels a failed review (see diagnoseReviewFailure). */
interface ReviewDiagnosisRow {
  status: string;
  command_center_id: string;
  submitted_by_id: string | null;
  reviewer_role: string | null;
  reviewer_cc: string | null;
}

export class IncidentReportRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Shared typed-rows helper (see cursor.util), bound to this repository's db. */
  private queryRows<T>(sql: string, params: unknown[]): Promise<T[]> {
    return queryRowsOn<T>(this.db, sql, params);
  }

  /**
   * Creates a report and returns its id.
   * Returns null if reporter_id is not an active responder with a home command
   * center. Throws on a duplicate report for the same incident and command
   * center (23505), an unknown incident (23503), or status 'submitted' without
   * a disposition (23514): map those in the service.
   */
  async createReport(data: CreateReportData): Promise<string | null> {
    const {
      incident_id,
      reporter_id,
      summary,
      disposition,
      detailed_narrative,
      evidence_urls,
      status = 'draft',
    } = data;

    const rows = await this.queryRows<{ id: string }>(
      `INSERT INTO incident_report (
         incident_id, command_center_id, assigned_reporter_id, submitted_by_id,
         disposition, summary, detailed_narrative, evidence_urls, status,
         submitted_at
       )
       SELECT $1::uuid, u.command_center_id, u.id,
              CASE WHEN $6::report_status = 'submitted' THEN u.id END,
              $3::incident_disposition_enum, $4::text, $5::text,
              $7::jsonb, $6::report_status,
              CASE WHEN $6::report_status = 'submitted' THEN now() END
         FROM user_account u
        WHERE u.id = $2::uuid
          AND u.role = 'responder'
          AND u.deleted_at IS NULL
          AND u.command_center_id IS NOT NULL
       RETURNING id`,
      [
        incident_id,
        reporter_id,
        disposition ?? null,
        summary,
        detailed_narrative ?? null,
        status,
        JSON.stringify(evidence_urls ?? []),
      ],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * The assigned reporter submits (or resubmits after a revision request).
   * The database does not stamp submitted_at or clear review fields itself,
   * and its consistency check rejects a 'submitted' row that still carries a
   * reviewer, so both are handled here. reviewer_notes is kept so the
   * reporter can still see what was asked for.
   * Returns false if the report is not theirs or not in draft / needs_revision.
   * Throws (23514) if no disposition exists yet.
   */
  async submitReport(
    reportId: string,
    submitterId: string,
    disposition?: IncidentDisposition | null,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident_report
          SET status = 'submitted',
              submitted_by_id = $2::uuid,
              submitted_at = now(),
              disposition = COALESCE($3::incident_disposition_enum, disposition),
              reviewed_by = NULL,
              reviewed_at = NULL
        WHERE id = $1::uuid
          AND assigned_reporter_id = $2::uuid
          AND status IN ('draft', 'needs_revision')`,
      [reportId, submitterId, disposition ?? null],
    );
    return result.rowCount === 1;
  }

  /**
   * Admin/super picks a submitted report up for review (submitted ->
   * under_review). The schema requires reviewed_by to stay NULL in this state,
   * so who is reviewing is not recorded until they approve or send it back.
   */
  async startReportReview(
    reportId: string,
    reviewerId: string,
  ): Promise<ReviewResult> {
    const result = await this.db.query(
      `UPDATE incident_report r
          SET status = 'under_review'
        WHERE r.id = $1::uuid
          AND r.status = 'submitted'
          AND r.submitted_by_id IS DISTINCT FROM $2::uuid
          AND ${REVIEWER_IS_AUTHORIZED}`,
      [reportId, reviewerId],
    );
    return result.rowCount === 1
      ? 'reviewed'
      : this.diagnoseReviewFailure(reportId, reviewerId);
  }

  /**
   * Approves a submitted / under-review report. `notes` are optional and
   * replace any earlier reviewer notes (so an approval never shows a stale
   * "please fix X" from a previous round).
   */
  async approveReport(
    reportId: string,
    reviewerId: string,
    notes?: string | null,
  ): Promise<ReviewResult> {
    return this.finishReview(reportId, reviewerId, 'approved', notes ?? null);
  }

  /**
   * Sends a submitted / under-review report back to its reporter. `notes` are
   * required by the schema (and shown to the reporter): validate that they
   * are non-blank before calling.
   */
  async requestReportRevision(
    reportId: string,
    reviewerId: string,
    notes: string,
  ): Promise<ReviewResult> {
    return this.finishReview(reportId, reviewerId, 'needs_revision', notes);
  }

  // The status guard matters: the schema alone would let a draft be approved
  // straight away, as long as a reviewer is recorded.
  private async finishReview(
    reportId: string,
    reviewerId: string,
    status: 'approved' | 'needs_revision',
    notes: string | null,
  ): Promise<ReviewResult> {
    const result = await this.db.query(
      `UPDATE incident_report r
          SET status = $3::report_status,
              reviewed_by = $2::uuid,
              reviewed_at = now(),
              reviewer_notes = $4::text
        WHERE r.id = $1::uuid
          AND r.status IN ('submitted', 'under_review')
          AND r.submitted_by_id IS DISTINCT FROM $2::uuid
          AND ${REVIEWER_IS_AUTHORIZED}`,
      [reportId, reviewerId, status, notes],
    );
    return result.rowCount === 1
      ? 'reviewed'
      : this.diagnoseReviewFailure(reportId, reviewerId);
  }

  /**
   * Labels a zero-row review update. Read-only and not atomic with the update;
   * it only picks the message, so a race can at worst mislabel a failure.
   */
  private async diagnoseReviewFailure(
    reportId: string,
    reviewerId: string,
  ): Promise<ReviewResult> {
    const rows = await this.queryRows<ReviewDiagnosisRow>(
      `SELECT r.status, r.command_center_id, r.submitted_by_id,
              u.role AS reviewer_role, u.command_center_id AS reviewer_cc
         FROM incident_report r
         LEFT JOIN user_account u ON u.id = $2::uuid AND u.deleted_at IS NULL
        WHERE r.id = $1::uuid`,
      [reportId, reviewerId],
    );
    const row = rows[0];
    if (!row) return 'not_found';

    const authorized =
      row.reviewer_role === 'super' ||
      (row.reviewer_role === 'admin' &&
        row.reviewer_cc === row.command_center_id);
    if (!authorized) return 'forbidden';
    if (row.submitted_by_id === reviewerId) return 'own_report';
    return 'not_reviewable';
  }

  /**
   * The assigned reporter edits their report while it is a draft or has been
   * sent back for revision. Omit a field to leave it, send null to clear a
   * nullable one. Returns the updated report, or null if nothing changed:
   * no fields given, or the report is not theirs / not editable any more.
   * Reviewer fields and notes are untouched, so a report under revision keeps
   * the reviewer's request visible while it is being fixed.
   * Throws (23514) if clearing the disposition of a report that is no longer a draft.
   */
  async updateReportDraft(
    reportId: string,
    reporterId: string,
    fields: UpdateReportDraftData,
  ): Promise<IncidentReportEntity | null> {
    const params: unknown[] = [reportId, reporterId];
    const sets: string[] = [];
    // Column names come from this fixed list, never from the caller.
    const set = (column: string, cast: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}::${cast}`);
    };
    if (fields.summary !== undefined) set('summary', 'text', fields.summary);
    if (fields.detailed_narrative !== undefined) {
      set('detailed_narrative', 'text', fields.detailed_narrative);
    }
    if (fields.disposition !== undefined) {
      set('disposition', 'incident_disposition_enum', fields.disposition);
    }
    if (fields.evidence_urls !== undefined) {
      set('evidence_urls', 'jsonb', JSON.stringify(fields.evidence_urls));
    }
    if (sets.length === 0) return null;

    const rows = await this.queryRows<IncidentReportEntity>(
      `UPDATE incident_report
          SET ${sets.join(', ')}
        WHERE id = $1::uuid
          AND assigned_reporter_id = $2::uuid
          AND status IN ('draft', 'needs_revision')
        RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async findReportById(reportId: string): Promise<IncidentReportEntity | null> {
    const rows = await this.queryRows<IncidentReportEntity>(
      `SELECT * FROM incident_report WHERE id = $1::uuid`,
      [reportId],
    );
    return rows[0] ?? null;
  }

  /**
   * The admin review queue: submitted and under-review reports, OLDEST first
   * (first in, first reviewed), one cursor page at a time. Pass a command
   * center id for an admin's own queue, or null for a super's view of all.
   * There is no dedicated index for this queue (the needs_action index covers
   * draft / needs_revision only); the command-center index is enough until the
   * table is large. Throws InvalidCursorError for a bad cursor.
   */
  async findReportsAwaitingReview(
    commandCenterId: string | null,
    { limit, cursor }: PageOptions = {},
  ): Promise<CursorPage<IncidentReportEntity>> {
    const size = clampLimit(limit);
    const params: unknown[] = [commandCenterId];
    // submitted_at is app-stamped, not DB-enforced: fall back to created_at so
    // a row without it can never break the sort key.
    const sortAt = 'COALESCE(r.submitted_at, r.created_at)';
    const keyset = keysetPredicate(cursor, params, sortAt, 'r.id', '>');
    params.push(size + 1);

    const rows = await this.queryRows<
      IncidentReportEntity & { cursor_t: string }
    >(
      `SELECT r.*, ${cursorTsSql(sortAt)} AS ${CURSOR_COLUMN}
         FROM incident_report r
        WHERE r.status IN ('submitted', 'under_review')
          AND ($1::uuid IS NULL OR r.command_center_id = $1::uuid)
          ${keyset}
        ORDER BY ${sortAt} ASC, r.id ASC
        LIMIT $${params.length}`,
      params,
    );

    const page = toPage(rows, size, (r) => ({ t: r.cursor_t, id: r.id }));
    return {
      items: page.items.map((r) => stripCursorColumn(r)),
      nextCursor: page.nextCursor,
    };
  }
}
