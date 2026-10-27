import { DatabaseService } from '../../database/database.service';
import { IncidentDisposition } from './enums/incident-disposition.enum';
import { ReportStatus } from './enums/report-status.enum';
import { IncidentReportEntity } from './interfaces/incident-report-entity.interface';
import {
  CreateReportData,
  ReviewResult,
  UpdateReportDraftData,
} from './types/datas/incident-report-datas/create-report-data.types';
import type { IncidentReportSummaryResponseDto } from './dto/incident-report-summary.dto';
import type {
  ReportSortBy,
  SortOrder,
} from './dto/list-incident-report-query.dto';

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
 */
const REVIEWER_IS_AUTHORIZED = `
  EXISTS (
    SELECT 1 FROM user_account u
     WHERE u.id = $2::uuid
       AND u.deleted_at IS NULL
       AND (u.role = 'super'
            OR (u.role = 'admin' AND u.command_center_id = r.command_center_id))
  )`;

interface ReviewDiagnosisRow {
  status: string;
  command_center_id: string;
  submitted_by_id: string | null;
  reviewer_role: string | null;
  reviewer_cc: string | null;
}

/**
 * Concrete scope the service has already enforced. Both may be unset (super
 * with no filters = global view).
 */
export interface ReportScope {
  commandCenterId?: string | null;
  reporterId?: string | null;
}

interface ReportSummaryRow {
  total: number;
  draft: number;
  submitted: number;
  under_review: number;
  needs_revision: number;
  approved: number;
}

export class IncidentReportRepository {
  constructor(private readonly db: DatabaseService) {}

  private queryRows<T>(sql: string, params: unknown[]): Promise<T[]> {
    return queryRowsOn<T>(this.db, sql, params);
  }

  // ==================================================================
  // EXISTING CRUD
  // ==================================================================

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

  async approveReport(
    reportId: string,
    reviewerId: string,
    notes?: string | null,
  ): Promise<ReviewResult> {
    return this.finishReview(reportId, reviewerId, 'approved', notes ?? null);
  }

  async requestReportRevision(
    reportId: string,
    reviewerId: string,
    notes: string,
  ): Promise<ReviewResult> {
    return this.finishReview(reportId, reviewerId, 'needs_revision', notes);
  }

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

  async updateReportDraft(
    reportId: string,
    reporterId: string,
    fields: UpdateReportDraftData,
  ): Promise<IncidentReportEntity | null> {
    const params: unknown[] = [reportId, reporterId];
    const sets: string[] = [];
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

  async findReportsAwaitingReview(
    commandCenterId: string | null,
    { limit, cursor }: PageOptions = {},
  ): Promise<CursorPage<IncidentReportEntity>> {
    const size = clampLimit(limit);
    const params: unknown[] = [commandCenterId];
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

  // ==================================================================
  // NEW: summary + offset-paginated list
  // ==================================================================

  async getReportSummary(
    scope: ReportScope,
  ): Promise<IncidentReportSummaryResponseDto> {
    const { sql: whereSql, params } = this.buildScopeWhere(scope);

    const rows = await this.queryRows<ReportSummaryRow>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE r.status = 'draft')::int          AS draft,
         COUNT(*) FILTER (WHERE r.status = 'submitted')::int      AS submitted,
         COUNT(*) FILTER (WHERE r.status = 'under_review')::int   AS under_review,
         COUNT(*) FILTER (WHERE r.status = 'needs_revision')::int AS needs_revision,
         COUNT(*) FILTER (WHERE r.status = 'approved')::int       AS approved
       FROM incident_report r
       WHERE ${whereSql}`,
      params,
    );

    const row: ReportSummaryRow = rows[0] ?? {
      total: 0,
      draft: 0,
      submitted: 0,
      under_review: 0,
      needs_revision: 0,
      approved: 0,
    };

    const pendingReview = row.submitted + row.under_review;

    return {
      total: row.total,
      draft: row.draft,
      submitted: row.submitted,
      under_review: row.under_review,
      needs_revision: row.needs_revision,
      approved: row.approved,
      pending_review: pendingReview,
      awaiting_verification: pendingReview,
      request_revision: row.needs_revision,
      awaiting_submission: row.draft,
    };
  }

  async findReportsPaginated(
    scope: ReportScope,
    filters: {
      status?: ReportStatus;
      sortBy: ReportSortBy;
      sortOrder: SortOrder;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: IncidentReportEntity[]; total: number }> {
    const { sql: scopeSql, params: scopeParams } = this.buildScopeWhere(scope);
    const params: unknown[] = [...scopeParams];
    const conditions: string[] = [scopeSql];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`r.status = $${params.length}::report_status`);
    }

    const whereSql = conditions.join(' AND ');
    const orderBy = this.buildOrderBy(filters.sortBy, filters.sortOrder);

    // Total — same WHERE, no pagination
    const totalRows = await this.queryRows<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM incident_report r WHERE ${whereSql}`,
      params,
    );
    const total = totalRows[0]?.total ?? 0;

    if (total === 0) return { items: [], total: 0 };

    // Page — same WHERE, plus LIMIT/OFFSET. Short-circuit if offset is past end.
    if (filters.offset >= total) return { items: [], total };

    const pageParams = [...params, filters.limit, filters.offset];
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;

    const items = await this.queryRows<IncidentReportEntity>(
      `SELECT r.*
         FROM incident_report r
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      pageParams,
    );

    return { items, total };
  }

  // ==================================================================
  // helpers
  // ==================================================================

  /**
   * Turns a role-enforced ReportScope into a WHERE fragment.
   * Returns `'TRUE'` when nothing is set, so callers can always join it.
   */
  private buildScopeWhere(scope: ReportScope): {
    sql: string;
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (scope.commandCenterId) {
      params.push(scope.commandCenterId);
      conditions.push(`r.command_center_id = $${params.length}::uuid`);
    }
    if (scope.reporterId) {
      params.push(scope.reporterId);
      conditions.push(`r.assigned_reporter_id = $${params.length}::uuid`);
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
      params,
    };
  }

  /**
   * ORDER BY fragment. `sortBy` / `sortOrder` are pre-validated by the DTO,
   * so interpolating them is safe (no user-controlled fragments reach this).
   *
   * Status sort uses the natural workflow order so "sort by status" reads
   * left-to-right as the report moves through its lifecycle.
   */
  private buildOrderBy(sortBy: ReportSortBy, sortOrder: SortOrder): string {
    const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
    switch (sortBy) {
      case 'status':
        return `CASE r.status
                  WHEN 'draft'          THEN 1
                  WHEN 'submitted'      THEN 2
                  WHEN 'under_review'   THEN 3
                  WHEN 'needs_revision' THEN 4
                  WHEN 'approved'       THEN 5
                END ${dir}, r.created_at DESC, r.id DESC`;
      case 'created_at':
        return `r.created_at ${dir}, r.id ${dir}`;
      case 'updated_at':
        return `r.updated_at ${dir}, r.id ${dir}`;
      case 'submitted_at':
        return `r.submitted_at ${dir} NULLS LAST, r.id ${dir}`;
      case 'reviewed_at':
        return `r.reviewed_at ${dir} NULLS LAST, r.id ${dir}`;
    }
  }
}
