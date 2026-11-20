import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateAuditLogInput } from './types/create-audit.type';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { AuditCursor } from './interfaces/audit-cursor.interface';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { GetAuditLogsParams } from './interfaces/get-audit-logs-params.interface';
import { commandCenterId } from './types/command-center-id.types';

/**
 * Maximum page size for {@link AuditLogsRepository.getAll}. Defensive cap on
 * top of whatever the DTO validates, so a malformed request cannot ask the
 * database for a million rows.
 */
const MAX_LIMIT = 100;

/** Default page size when the caller does not specify one. */
const DEFAULT_LIMIT = 20;

/**
 * Data access for `system_audit_log` and its command-center join.
 *
 * ## Table shape (migrations 001, 010, 014)
 *
 * `system_audit_log` is a **partitioned table** (`PARTITION BY RANGE (created_at)`),
 * with one partition per calendar month. Its primary key is `(id, created_at)` —
 * *not* `id` alone — because Postgres requires the partition key in the PK.
 * Consequences every method here has to respect:
 *
 * - A lookup by `id` alone scans every partition. When the caller can supply
 *   `createdAt`, we add it to the WHERE clause so the planner prunes to one
 *   partition. This is why {@link AuditLogsRepository.get} and
 *   {@link AuditLogsService.getAuditLog} accept an optional `createdAt`.
 * - Cursor pagination must be tuple-based on `(created_at, id)`, not on `id`,
 *   for a stable ordering across month boundaries.
 *
 * ## Column contract (matches `SystemAuditLogEntity`)
 *
 * The SELECT projection below aliases each column to the camelCase field name
 * the entity / API exposes. Field-by-field meaning:
 *
 * | Column              | Aliased as          | Meaning                                                                    |
 * | ------------------- | ------------------- | -------------------------------------------------------------------------- |
 * | `sal.id`            | `id`                | Row UUID. Not globally unique without `created_at` (partition-key PK).     |
 * | `sal.actor_id`      | `actorId`           | FK to `user_account` who performed the action. `NULL` = system/engine.     |
 * | `sal.actor_name`    | `actorName`         | Denormalized `f_name || ' ' || l_name` snapshot (014). Survives user rename. |
 * | `sal.command_center_id` | `commandCenterId` | Owning command center. **The row's scoping key** — every query is bound to it. |
 * | `cc.name`           | `commandCenterName` | Convenience join so the UI never has to look up the CC separately.       |
 * | `sal.action`        | `action`            | `audit_action` enum — verb of the event (e.g. `CLAIM_INCIDENT`, `LINK_IDENTITY`). |
 * | `sal.target_entity` | `targetEntity`      | Noun the verb acted on — `'incident'`, `'incident_report'`, etc. (`category` on the wire). |
 * | `sal.target_id`     | `targetId`          | UUID of the affected row in `target_entity`'s table.                      |
 * | `sal.old_payload`   | `oldPayload`        | JSONB before-state for diffs. `NULL` on CREATE.                           |
 * | `sal.new_payload`   | `newPayload`        | JSONB after-state for diffs. `NULL` on DELETE.                            |
 * | `sal.created_at`    | `createdAt`         | **Partition key.** Ordering column for the paginated list.                |
 *
 * Actions in the enum come from migrations 001, 010, and 012 and cover
 * provisioning, auth, incident lifecycle, dispatch, verification, reporting,
 * identity linking, phone/email verification, duty toggles, and account
 * deactivation. New actions can only be added by migration (enum).
 *
 * ## Two write paths converge here
 *
 * 1. **Trigger path** — `audit_incident_event`, `audit_report_submission`,
 *    `notify_and_audit_report_review`, `audit_incident_escalation` insert rows
 *    from within the transaction that caused the state change.
 * 2. **Application path** — {@link AuditLogsRepository.createAudit} is used by
 *    call sites that have no trigger coverage (identity link/unlink, phone
 *    verify, duty change, deactivate/reactivate, etc.). It is a plain INSERT
 *    that also fills `actor_name`, mirroring what the trigger functions do.
 */
@Injectable()
export class AuditLogsRepository {
  /**
   * SELECT list shared by `get`, `getAll`, and the `createAudit` read-back.
   *
   * All `sal.*` columns are prefixed to avoid ambiguity with the joined
   * `command_center cc`. Each column is aliased to the entity's camelCase
   * field — see the class-level doc table for what each column means.
   */
  private readonly SELECT_PROJECTION = `
    sal.id,
    sal.actor_id AS "actorId",
    sal.actor_name AS "actorName",
    sal.command_center_id AS "commandCenterId",
    cc.name AS "commandCenterName",
    sal.action,
    sal.target_entity AS "targetEntity",
    sal.target_id AS "targetId",
    sal.old_payload AS "oldPayload",
    sal.new_payload AS "newPayload",
    sal.created_at AS "createdAt"
  `;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Application-path insert into `system_audit_log`.
   *
   * Used for audited actions that no DB trigger covers — identity link/unlink,
   * phone/email verification, duty changes, account deactivate/reactivate,
   * manual assignments, etc. Trigger-authored rows (incident lifecycle,
   * report review, escalation) go through the SQL functions instead and do not
   * call this method.
   *
   * @param data
   *  - `id` – optional UUID. When omitted, the DB fills `gen_random_uuid()`.
   *    Supplying it is useful when you need to correlate an audit row with an
   *    in-flight operation before it commits.
   *  - `actorId` – `user_account.id` of the actor. `null` means "the system did
   *    this" (sweeper, wave engine, migration).
   *  - `commandCenterId` – scoping CC. `null` is allowed for truly global
   *    actions (e.g. super-admin operations not bound to a single CC), but
   *    then the row is invisible to CC-scoped listing. Prefer a CC when you
   *    have one.
   *  - `action` – enum verb. Adding a new action requires a migration.
   *  - `targetEntity` / `targetId` – noun + PK of the affected row.
   *  - `oldPayload` / `newPayload` – JSONB before/after; serialize with
   *    `JSON.stringify` and cast server-side.
   *  - `createdAt` – optional; defaults to `now()`. **Do not backdate by more
   *    than ~1 month unless the target partition already exists** — audit
   *    partitions are pre-provisioned by migration and anything outside the
   *    covered ranges lands in `system_audit_log_default`, which is a footgun
   *    for retention management.
   *
   * @returns the inserted row, re-joined to `command_center` so
   *          `commandCenterName` is populated in the response.
   *
   * @remarks
   * `actorName` is derived here by a secondary `SELECT` against `user_account`
   * so the snapshot lands correctly. If the actor is hard-deleted later, the
   * row keeps the historical name — that is intentional (denormalized
   * snapshot, per migration 014).
   */
  async createAudit(data: CreateAuditLogInput): Promise<SystemAuditLogEntity> {
    let actorName: string | null = null;
    if (data.actorId) {
      const nameResult = await this.db.query<{
        f_name: string;
        l_name: string;
      }>(`SELECT f_name, l_name FROM user_account WHERE id = $1`, [
        data.actorId,
      ]);
      if (nameResult.rows.length > 0) {
        const { f_name, l_name } = nameResult.rows[0];
        actorName = `${f_name} ${l_name}`;
      }
    }

    // Using a CTE to insert, then joining to get the command center name
    const sql = `
      WITH inserted AS (
        INSERT INTO system_audit_log (
          id,
          actor_id,
          actor_name,
          command_center_id,
          action,
          target_entity,
          target_id,
          old_payload,
          new_payload,
          created_at
        ) VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          $9::jsonb,
          COALESCE($10::timestamptz, now())
        )
        RETURNING *
      )
      SELECT ${this.SELECT_PROJECTION}
      FROM inserted sal
      LEFT JOIN command_center cc ON cc.id = sal.command_center_id;
    `;

    const params: (string | null)[] = [
      data.id ?? null,
      data.actorId ?? null,
      actorName,
      data.commandCenterId ?? null,
      data.action,
      data.targetEntity,
      data.targetId,
      data.oldPayload ? JSON.stringify(data.oldPayload) : null,
      data.newPayload ? JSON.stringify(data.newPayload) : null,
      data.createdAt ? data.createdAt.toISOString() : null,
    ];

    const result = await this.db.query<SystemAuditLogEntity>(sql, params);
    return result.rows[0];
  }

  /**
   * Fetch a single audit row, always scoped to a command center.
   *
   * @param commandCenterId – the CC the caller is authorised against. The
   *   service layer guarantees this is either the caller's own CC (admin) or
   *   an explicit, existence-checked CC UUID (super).
   * @param id – the audit row's `id`.
   * @param createdAt – **strongly recommended.** `system_audit_log` is
   *   partitioned by `created_at`, so passing this lets Postgres prune to a
   *   single monthly partition instead of scanning all of them. The controller
   *   exposes it via `GetSingleAuditQueryDto.createdAt`. If omitted, the query
   *   is exact-match `id = $2` only and will fan out across partitions.
   *
   * @returns the row, or `null` when not found **in the caller's CC scope** —
   *          a row that exists in another CC is indistinguishable from a row
   *          that does not exist. That is deliberate: it prevents CC-id
   *          leakage via 403 vs 404 responses.
   *
   * @remarks
   * When `createdAt` is supplied it is matched with `=` on `timestamptz` — the
   * client must echo a timestamp it received earlier at full precision
   * (microseconds). Reconstructing it from a `Date` object that lost μs will
   * miss.
   */
  async get(
    commandCenterId: string,
    id: string,
    createdAt?: Date,
  ): Promise<SystemAuditLogEntity | null> {
    let sql = `
      SELECT ${this.SELECT_PROJECTION}
      FROM system_audit_log sal
      LEFT JOIN command_center cc ON cc.id = sal.command_center_id
      WHERE sal.command_center_id = $1 AND sal.id = $2
    `;
    const params: (string | Date)[] = [commandCenterId, id];

    if (createdAt) {
      sql += ` AND sal.created_at = $3`;
      params.push(createdAt);
    }

    const result = await this.db.query<SystemAuditLogEntity>(sql, params);
    return result.rows[0] ?? null;
  }

  /**
   * Keyset-paginated listing, always scoped to a command center.
   *
   * Ordering: `created_at DESC, id DESC`. Cursor is the encoded tuple of the
   * last row on the previous page, applied as
   * `(created_at, id) < (cursor.createdAt, cursor.id)` — correct even across
   * partition boundaries because `created_at` alone is not unique.
   *
   * @param params
   *  - `commandCenterId` – required scoping key (aliased to `category` on the
   *    wire? No — see `category` below. This is the CC UUID).
   *  - `limit` – page size, default {@link DEFAULT_LIMIT}, capped at
   *    {@link MAX_LIMIT}.
   *  - `cursor` – opaque base64(JSON`{createdAt, id}`) from a previous page.
   *    Filters are **not** encoded in the cursor; if the client changes
   *    `action`/`category`/`actorId`/`from`/`to` mid-pagination the caller is
   *    responsible for restarting from a null cursor.
   *  - `action` – array of `audit_action` enum values (OR within the array).
   *  - `category` – array of `target_entity` strings (OR within the array).
   *    Named `category` on the wire but **maps to `sal.target_entity`**.
   *  - `actorId` – exact-match on `sal.actor_id`.
   *  - `from` / `to` – inclusive `[from, to]` bounds on `sal.created_at`.
   *    Passing these is what lets the planner prune partitions.
   *
   * @returns `{ data, nextCursor }`. `nextCursor` is `null` unless the page
   *          was exactly `limit` rows long — in which case the client should
   *          make one more request and expect an empty page if there is no
   *          further data.
   *
   * @throws {BadRequestException} when `cursor` is malformed base64 or does not
   *         decode to `{ createdAt: string, id: string }`.
   *
   * @remarks
   * **Index gap.** Migration 001 only declares
   * `idx_audit_cc_id ON system_audit_log(command_center_id)`. The cursor
   * ordering needs `(command_center_id, created_at DESC, id DESC)` to avoid an
   * in-memory sort; until that index is added, expect a sort per page on
   * busy CCs. Tracked for a follow-up migration.
   */
  async getAll(params: GetAuditLogsParams): Promise<PaginatedAuditLogs> {
    const requestedLimit = params.limit ?? DEFAULT_LIMIT;
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

    const values: unknown[] = [params.commandCenterId];
    let paramIdx = 2;

    // Prefix all columns with 'sal.' so they don't conflict with command_center columns
    const clauses: string[] = [`sal.command_center_id = $1`];

    if (params.actorId) {
      clauses.push(`sal.actor_id = $${paramIdx++}`);
      values.push(params.actorId);
    }

    if (params.action && params.action.length > 0) {
      clauses.push(`sal.action = ANY($${paramIdx++}::audit_action[])`);
      values.push(params.action);
    }

    if (params.category && params.category.length > 0) {
      // `category` on the DTO maps to `system_audit_log.target_entity` — the
      // noun half of the (action, target_entity) pair.
      clauses.push(`sal.target_entity = ANY($${paramIdx++}::varchar[])`);
      values.push(params.category);
    }

    if (params.from) {
      clauses.push(`sal.created_at >= $${paramIdx++}::timestamptz`);
      values.push(params.from);
    }

    if (params.to) {
      clauses.push(`sal.created_at <= $${paramIdx++}::timestamptz`);
      values.push(params.to);
    }

    if (params.cursor) {
      try {
        const decoded = Buffer.from(params.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded) as unknown;

        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('createdAt' in parsed) ||
          !('id' in parsed) ||
          typeof (parsed as AuditCursor).createdAt !== 'string' ||
          typeof (parsed as AuditCursor).id !== 'string'
        ) {
          throw new BadRequestException('Invalid cursor payload');
        }

        const { createdAt, id } = parsed as AuditCursor;

        // Cursor tuple matching
        clauses.push(
          `(sal.created_at, sal.id) < ($${paramIdx++}::timestamptz, $${paramIdx++}::uuid)`,
        );
        values.push(createdAt, id);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('Malformed cursor token');
      }
    }

    values.push(limit);
    const limitIdx = paramIdx;

    const sql = `
      SELECT ${this.SELECT_PROJECTION}
      FROM system_audit_log sal
      LEFT JOIN command_center cc ON cc.id = sal.command_center_id
      WHERE ${clauses.join('\n        AND ')}
      ORDER BY sal.created_at DESC, sal.id DESC
      LIMIT $${limitIdx};
    `;

    const result = await this.db.query<SystemAuditLogEntity>(sql, values);
    const rows = result.rows;

    let nextCursor: string | null = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      const cursorObj: AuditCursor = {
        createdAt:
          last.createdAt instanceof Date
            ? last.createdAt.toISOString()
            : String(last.createdAt),
        id: last.id,
      };
      nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString('base64');
    }

    return {
      data: rows,
      nextCursor,
    };
  }

  /**
   * Existence check for a command center UUID.
   *
   * Used by {@link AuditLogsService.resolveCommandCenterId} when a **super**
   * user supplies `?commandCenterId=…` — we must reject unknown CC UUIDs
   * before they short-circuit into an empty result set that looks like
   * "this CC has no logs".
   *
   * @returns the CC UUID when it exists, otherwise `undefined`. Returning
   *          `undefined` (rather than throwing) keeps this a pure lookup;
   *          the service layer decides whether to raise 404.
   *
   * @remarks
   * Return type is `string | undefined`, not `string`. Callers must guard
   * with `if (!existing)`. Any signature that advertises `Promise<string>`
   * here is lying to `strictNullChecks`.
   */
  async getCommandCenterIdOnId(id: string): Promise<string | undefined> {
    const sql = 'SELECT id FROM command_center WHERE id = $1';
    const result = await this.db.query<commandCenterId>(sql, [id]);
    return result.rows[0]?.id;
  }
}
