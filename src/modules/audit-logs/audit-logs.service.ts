import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogsRepository } from './audit-logs.repository';
import { CreateAuditLogInput } from './types/create-audit.type';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';
import { GetSingleAuditQueryDto } from './dto/get-single-audit-query.dto';
import { Role } from '../../common/enums/role-enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/** Anchors date-only bounds to UTC start/end of day. */
function normalizeBound(
  value: string | undefined,
  bound: 'from' | 'to',
): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return bound === 'from'
      ? `${value}T00:00:00.000Z`
      : `${value}T23:59:59.999Z`;
  }
  return value;
}

/**
 * Read/write surface for `system_audit_log` and its surrounding scoping rules.
 *
 * ## Responsibility split
 *
 * - **Scoping** is a service concern. Every call resolves to exactly one
 *   `command_center_id` before hitting the repository. Admins are confined to
 *   their own CC from the JWT; supers must explicitly pass
 *   `?commandCenterId=…`, which we then existence-check. This is the only
 *   place that decision is made — the repository assumes the CC is trusted.
 * - **Query shape** (cursor validation, limit caps, tuple ordering) is the
 *   repository's job.
 * - **Input validation** that the DTO cannot express (date-order, cross-field
 *   rules) is done here.
 *
 * ## Why the read paths exist
 *
 * The audit log is a compliance surface, not a business-logic table. It is
 * written by:
 *
 * - DB triggers on `incident`, `incident_escalation`, `incident_report`, and
 *   `incident_responder_assignment` (migrations 001, 014), and
 * - {@link AuditLogsService.createAudit}, called from application code for
 *   events with no trigger coverage (identity link/unlink, phone/email
 *   verification, duty toggles, account deactivation/reactivation; see
 *   migrations 010 and 012).
 *
 * Both paths converge on the same partitioned table. The service presents one
 * coherent read model over both.
 *
 * ## Column reference
 *
 * See the class-level TSDoc on {@link AuditLogsRepository} for the full
 * column contract. Short version, keyed by the DTO field names callers use:
 *
 * - `action` → `sal.action` — `audit_action` enum verb.
 * - `category` → `sal.target_entity` — noun the verb acted on. **Not the same
 *   as the `threat_category` enum on `incident`.** Here it is the string
 *   `'incident' | 'incident_report' | …`.
 * - `actorId` → `sal.actor_id` — nullable; `NULL` means "the system did this"
 *   (sweeper, wave engine, migration).
 * - `from` / `to` → `sal.created_at` bounds, inclusive, after UTC day-anchoring.
 *
 * ## Partitioning note
 *
 * `system_audit_log` is partitioned by month on `created_at`. Adding `from`/
 * `to` to the list query, and passing `createdAt` to a single-row lookup, is
 * what lets the planner prune partitions. Omitting them is correct but scans
 * every partition — acceptable for rare calls, expensive at scale.
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly auditLogsRepository: AuditLogsRepository) {}

  /**
   * Application-path write to the audit log.
   *
   * Thin pass-through to {@link AuditLogsRepository.createAudit}. Kept on the
   * service so downstream modules import `AuditLogsService` (already exported
   * from {@link AuditLogsModule}) rather than touching the repository
   * directly.
   *
   * @param input – see {@link CreateAuditLogInput}. `commandCenterId` is
   *   optional on the type but should be supplied whenever the action is
   *   CC-scoped, otherwise the row is invisible to any CC-scoped listing.
   *
   * @returns the persisted row, re-joined to `command_center` so
   *          `commandCenterName` is populated.
   */
  async createAudit(input: CreateAuditLogInput): Promise<SystemAuditLogEntity> {
    return this.auditLogsRepository.createAudit(input);
  }

  /**
   * Fetch one audit row, scoped to a command center.
   *
   * @param auditId – `system_audit_log.id`.
   * @param user – the authenticated caller; drives the CC scoping decision in
   *   {@link resolveCommandCenterId}.
   * @param query
   *   - `commandCenterId` – required for `super`, ignored for `admin`.
   *   - `createdAt` – **strongly recommended.** `system_audit_log` is
   *     partitioned by `created_at`; supplying it lets the planner prune to a
   *     single partition. Without it, the query scans every partition that
   *     still exists. It must be the exact `timestamptz` the caller received
   *     on a previous response (exact-match on the DB).
   *
   * @throws {BadRequestException} when a super user omits `commandCenterId`.
   * @throws {NotFoundException} when the CC UUID does not exist, or the audit
   *   row is not found **in the caller's CC scope** (deliberate: a row in a
   *   different CC returns 404, not 403 — no CC-id leakage).
   */
  async getAuditLog(
    auditId: string,
    user: AuthenticatedUser,
    query?: GetSingleAuditQueryDto,
  ): Promise<SystemAuditLogEntity> {
    const commandCenterId = await this.resolveCommandCenterId(
      user,
      query?.commandCenterId,
    );

    const auditLog = await this.auditLogsRepository.get(
      commandCenterId,
      auditId,
      query?.createdAt,
    );

    if (!auditLog) {
      throw new NotFoundException(`Audit log "${auditId}" not found.`);
    }

    return auditLog;
  }

  /**
   * Paginated listing of audit rows, scoped to a command center.
   *
   * @param user – the authenticated caller; drives the CC scoping decision.
   * @param query – see {@link GetAuditLogsQueryDto}. Relevant fields and the
   *   columns they touch:
   *   - `commandCenterId` → the scoping key `sal.command_center_id`.
   *     Required for `super`; ignored for `admin`.
   *   - `limit` → page size (capped in the repository).
   *   - `cursor` → opaque continuation token from `nextCursor`.
   *   - `action[]` → `sal.action` (enum).
   *   - `category[]` → `sal.target_entity` (**noun**, not the incident threat
   *     category).
   *   - `actorId` → `sal.actor_id`.
   *   - `from` / `to` → `sal.created_at` inclusive bounds. Date-only values
   *     are anchored to UTC start/end of day by {@link normalizeBound}.
   *
   * @returns `{ data, nextCursor }`. See {@link AuditLogsRepository.getAll}
   *   for cursor semantics.
   *
   * @throws {BadRequestException}
   *   - When a super user omits `commandCenterId`.
   *   - When `from > to` after normalization.
   *   - When the cursor is malformed (propagated from the repository).
   * @throws {NotFoundException} when a super user passes a CC UUID that does
   *   not exist.
   * @throws {ForbiddenException} when an `admin` caller has no
   *   `command_center_id` in their JWT (misconfigured provisioning).
   *
   * @remarks
   * **Filter changes invalidate the cursor.** The cursor is a tuple of
   * `(createdAt, id)` and does not encode the filters that produced it. If
   * the client changes `action`/`category`/`actorId`/`from`/`to` mid-
   * pagination, results may be surprising; callers should restart with no
   * cursor after changing filters.
   */
  async getAllAuditLogs(
    user: AuthenticatedUser,
    query: GetAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogs> {
    const commandCenterId = await this.resolveCommandCenterId(
      user,
      query.commandCenterId,
    );

    const from = normalizeBound(query.from, 'from');
    const to = normalizeBound(query.to, 'to');

    if (from && to && Date.parse(from) > Date.parse(to)) {
      throw new BadRequestException('from must be <= to');
    }

    return this.auditLogsRepository.getAll({
      commandCenterId,
      limit: query.limit,
      cursor: query.cursor,
      action: query.action,
      category: query.category,
      actorId: query.actorId,
      from,
      to,
    });
  }

  /**
   * Resolve the effective `command_center_id` for an audit query.
   *
   * Rules:
   * - **super** – must pass an explicit `commandCenterId`. We existence-check
   *   it so an unknown UUID fails 404 instead of masquerading as an empty CC.
   * - **admin** – the CC comes from their JWT (`user.command_center_id`). A
   *   supplied `commandCenterId` is **silently ignored** so an admin cannot
   *   widen scope by guessing other CC UUIDs.
   * - Anything else – the controller's `@Roles` already excludes
   *   `driver`/`responder`, so this branch is only reached if the guard is
   *   bypassed; we still fail closed with `ForbiddenException`.
   *
   * @throws {BadRequestException} super without `requested`.
   * @throws {NotFoundException} super with a `requested` UUID that does not
   *   exist in `command_center`.
   * @throws {ForbiddenException} an admin with no `command_center_id` in the
   *   token — this indicates a provisioning bug and is logged.
   */
  private async resolveCommandCenterId(
    user: AuthenticatedUser,
    requested?: string,
  ): Promise<string> {
    if (user.role === Role.SUPER) {
      if (!requested) {
        throw new BadRequestException(
          'commandCenterId is required for super users.',
        );
      }

      const existing =
        await this.auditLogsRepository.getCommandCenterIdOnId(requested);

      if (!existing) {
        throw new NotFoundException(`Command center "${requested}" not found.`);
      }

      return existing;
    }

    if (!user.command_center_id) {
      this.logger.warn(
        `User ${user.sub} (role: ${user.role}) has no command_center_id in token.`,
      );
      throw new ForbiddenException('No command center assigned to this user.');
    }

    return user.command_center_id;
  }
}
