import { DatabaseService } from '../../database/database.service';
import { IncidentDisposition } from './enums/incident-disposition.enum';
import { ReportStatus } from './enums/report-status.enum';
import { IncidentStatus } from './enums/incident-status.enum';
import { ThreatCategory } from './enums/threat-category.enum';
import { ThreatLevel } from './enums/threat-level.enum';
import { TriggerSource } from './enums/trigger-source.enum';
import { Injectable } from '@nestjs/common';
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
  clampLimit,
  cursorTsSql,
  keysetPredicate,
  queryRows as queryRowsOn,
  stripCursorColumn,
  toPage,
} from '../../common/utils/cursor-pagination-helper.util';

const REVIEWER_IS_AUTHORIZED = `
  EXISTS (
    SELECT 1 FROM user_account u
     WHERE u.id = $2::uuid
       AND u.deleted_at IS NULL
       AND (u.role = 'super'
            OR (u.role = 'admin' AND u.command_center_id = r.command_center_id))
  )`;

const INCIDENT_REPORT_SELECT = `
  r.*,
  i.status              AS incident_status,
  i.threat_category     AS incident_threat_category,
  i.threat_level        AS incident_threat_level,
  i.verified_at         AS incident_verified_at,
  i.verified_by_id      AS incident_verified_by_id,
  i.trigger_source      AS incident_trigger_source,
  i.claimed_by_id       AS incident_claimed_by_id,
  cu.f_name || ' ' || cu.l_name AS incident_claimed_by_name`;

interface ReviewDiagnosisRow {
  status: string;
  command_center_id: string;
  submitted_by_id: string | null;
  reviewer_role: string | null;
  reviewer_cc: string | null;
}

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

interface IncidentReportRow extends Record<string, unknown> {
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

  incident_status: IncidentStatus;
  incident_threat_category: ThreatCategory;
  incident_threat_level: ThreatLevel;
  incident_verified_at: Date | null;
  incident_verified_by_id: string | null;
  incident_trigger_source: TriggerSource;
  incident_claimed_by_id: string | null;
  incident_claimed_by_name: string | null;
}

/**
 * Adds the derived booleans.
 *
 * NOTE: every comparison below uses the enum MEMBER (e.g. ReportStatus.DRAFT)
 * rather than the string literal. TS enums are nominal types, so
 * `row.status === 'draft'` fails lint (@typescript-eslint/no-unsafe-enum-
 * comparison) even though the runtime value is identical. The members are
 * already imported at the top of this file — don't "simplify" them back to
 * string literals.
 */
function toIncidentReport(row: IncidentReportRow): IncidentReportEntity {
  return {
    ...row,
    is_report_draft: row.status === ReportStatus.DRAFT,
    is_report_pending_review:
      row.status === ReportStatus.SUBMITTED ||
      row.status === ReportStatus.UNDER_REVIEW,
    is_report_approved: row.status === ReportStatus.APPROVED,
    is_report_rejected: row.status === ReportStatus.NEEDS_REVISION,
    is_report_final: row.status === ReportStatus.APPROVED,
    is_incident_verified: row.incident_verified_at !== null,
    is_incident_resolved: row.incident_status === IncidentStatus.RESOLVED,
    is_incident_cancelled: row.incident_status === IncidentStatus.CANCELLED,
    is_incident_pending_verification:
      row.incident_status === IncidentStatus.AWAITING_VERIFICATION,
    // Mirrors chck_incident_resolution_safety_gate: fail-case only.
    needs_incident_verification:
      row.incident_status === IncidentStatus.AWAITING_VERIFICATION &&
      row.incident_verified_at === null &&
      (row.incident_threat_category === ThreatCategory.HAZARD ||
        (row.incident_threat_category === ThreatCategory.DE_ESCALATABLE &&
          row.incident_threat_level === ThreatLevel.ACTIVE_THREAT)),
  };
}

@Injectable()
export class IncidentReportRepository {
  constructor(private readonly db: DatabaseService) {}

  private queryRows<T>(sql: string, params: unknown[]): Promise<T[]> {
    return queryRowsOn<T>(this.db, sql, params);
  }

  // ==================================================================
  // CRUD
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

    const rows = await this.queryRows<IncidentReportRow>(
      `WITH updated AS (
         UPDATE incident_report
            SET ${sets.join(', ')}
          WHERE id = $1::uuid
            AND assigned_reporter_id = $2::uuid
            AND status IN ('draft', 'needs_revision')
          RETURNING *
       )
       SELECT ${INCIDENT_REPORT_SELECT}
         FROM updated r
         JOIN incident i ON i.id = r.incident_id
         LEFT JOIN user_account cu ON cu.id = i.claimed_by_id`,
      params,
    );
    return rows[0] ? toIncidentReport(rows[0]) : null;
  }

  async findReportById(reportId: string): Promise<IncidentReportEntity | null> {
    const rows = await this.queryRows<IncidentReportRow>(
      `SELECT ${INCIDENT_REPORT_SELECT}
         FROM incident_report r
         JOIN incident i ON i.id = r.incident_id
         LEFT JOIN user_account cu ON cu.id = i.claimed_by_id
        WHERE r.id = $1::uuid`,
      [reportId],
    );
    return rows[0] ? toIncidentReport(rows[0]) : null;
  }

  // ==================================================================
  // Cursor queue (kept, with new filters)
  // ==================================================================

  async findReportsAwaitingReview(
    commandCenterId: string | null,
    query: {
      trigger_sources?: TriggerSource[];
      from_date?: string;
      to_date?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<CursorPage<IncidentReportEntity>> {
    const size = clampLimit(query.limit);
    const sortAt = 'COALESCE(r.submitted_at, r.created_at)';

    const params: unknown[] = [];
    const conditions: string[] = [`r.status IN ('submitted', 'under_review')`];

    if (commandCenterId) {
      params.push(commandCenterId);
      conditions.push(`r.command_center_id = $${params.length}::uuid`);
    }
    if (query.trigger_sources?.length) {
      params.push(query.trigger_sources);
      conditions.push(
        `i.trigger_source = ANY($${params.length}::trigger_source_enum[])`,
      );
    }
    if (query.from_date) {
      params.push(query.from_date);
      conditions.push(
        `r.submitted_at >= ($${params.length}::date::timestamp AT TIME ZONE 'Asia/Manila')`,
      );
    }
    if (query.to_date) {
      params.push(query.to_date);
      conditions.push(
        `r.submitted_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')`,
      );
    }

    const whereSql = conditions.join(' AND ');
    const keyset = keysetPredicate(query.cursor, params, sortAt, 'r.id', '>');
    params.push(size + 1);

    const rows = await this.queryRows<IncidentReportRow & { cursor_t: string }>(
      `SELECT ${INCIDENT_REPORT_SELECT}, ${cursorTsSql(sortAt)} AS ${CURSOR_COLUMN}
         FROM incident_report r
         JOIN incident i ON i.id = r.incident_id
         LEFT JOIN user_account cu ON cu.id = i.claimed_by_id
        WHERE ${whereSql}
          ${keyset}
        ORDER BY ${sortAt} ASC, r.id ASC
        LIMIT $${params.length}`,
      params,
    );

    const page = toPage(rows, size, (r) => ({ t: r.cursor_t, id: r.id }));
    return {
      items: page.items.map((r) =>
        toIncidentReport(stripCursorColumn(r) as unknown as IncidentReportRow),
      ),
      nextCursor: page.nextCursor,
    };
  }

  // ==================================================================
  // Summary + offset list
  // ==================================================================

  async getReportSummary(
    scope: ReportScope,
    filters: {
      status?: ReportStatus;
      statuses?: ReportStatus[];
      incident_statuses?: IncidentStatus[];
      trigger_sources?: TriggerSource[];
      from_date?: string;
      to_date?: string;
    } = {},
  ): Promise<IncidentReportSummaryResponseDto> {
    const { sql: whereSql, params } = this.buildReportFilters(scope, filters);

    const rows = await this.queryRows<ReportSummaryRow>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE r.status = 'draft')::int          AS draft,
         COUNT(*) FILTER (WHERE r.status = 'submitted')::int      AS submitted,
         COUNT(*) FILTER (WHERE r.status = 'under_review')::int   AS under_review,
         COUNT(*) FILTER (WHERE r.status = 'needs_revision')::int AS needs_revision,
         COUNT(*) FILTER (WHERE r.status = 'approved')::int       AS approved
       FROM incident_report r
       JOIN incident i ON i.id = r.incident_id
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
      statuses?: ReportStatus[];
      incident_statuses?: IncidentStatus[];
      trigger_sources?: TriggerSource[];
      from_date?: string;
      to_date?: string;
      sortBy: ReportSortBy;
      sortOrder: SortOrder;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: IncidentReportEntity[]; total: number }> {
    const { sql: whereSql, params } = this.buildReportFilters(scope, filters);
    const orderBy = this.buildOrderBy(filters.sortBy, filters.sortOrder);

    const totalRows = await this.queryRows<{ total: number }>(
      `SELECT COUNT(*)::int AS total
         FROM incident_report r
         JOIN incident i ON i.id = r.incident_id
        WHERE ${whereSql}`,
      params,
    );
    const total = totalRows[0]?.total ?? 0;

    if (total === 0) return { items: [], total: 0 };
    if (filters.offset >= total) return { items: [], total };

    const pageParams = [...params, filters.limit, filters.offset];
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;

    const items = await this.queryRows<IncidentReportRow>(
      `SELECT ${INCIDENT_REPORT_SELECT}
         FROM incident_report r
         JOIN incident i ON i.id = r.incident_id
         LEFT JOIN user_account cu ON cu.id = i.claimed_by_id
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      pageParams,
    );

    return { items: items.map(toIncidentReport), total };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private buildReportFilters(
    scope: ReportScope,
    filters: {
      status?: ReportStatus;
      statuses?: ReportStatus[];
      incident_statuses?: IncidentStatus[];
      trigger_sources?: TriggerSource[];
      from_date?: string;
      to_date?: string;
    },
  ): { sql: string; params: unknown[] } {
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

    const reportStatuses =
      filters.statuses ?? (filters.status ? [filters.status] : undefined);
    if (reportStatuses && reportStatuses.length > 0) {
      params.push(reportStatuses);
      conditions.push(`r.status = ANY($${params.length}::report_status[])`);
    }

    if (filters.incident_statuses?.length) {
      params.push(filters.incident_statuses);
      conditions.push(
        `i.status = ANY($${params.length}::incident_status_enum[])`,
      );
    }

    if (filters.trigger_sources?.length) {
      params.push(filters.trigger_sources);
      conditions.push(
        `i.trigger_source = ANY($${params.length}::trigger_source_enum[])`,
      );
    }

    if (filters.from_date) {
      params.push(filters.from_date);
      conditions.push(
        `r.submitted_at >= ($${params.length}::date::timestamp AT TIME ZONE 'Asia/Manila')`,
      );
    }
    if (filters.to_date) {
      params.push(filters.to_date);
      conditions.push(
        `r.submitted_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')`,
      );
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
      params,
    };
  }

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
