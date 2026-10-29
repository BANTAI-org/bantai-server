import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateCommandCenterData } from './types/create-command-center-data.types';
import { UpdateCommandCenterData } from './types/update-command-center-data.types';
import { CommandCenterEntity } from './interfaces/command-center.interface';
import { ResponderTableRow } from './interfaces/responder-tb.interface';
import { ActorOption } from './interfaces/action-option.interface';

import { Role } from '../../common/enums/role-enum';
import { AccountStatusEnum } from '../../modules/auth/enums/account-status.enum';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { AgencyTypeEnum } from '../responders/enums/agency-type.enum';
import { AvailabilityStatusEnum } from '../responders/enums/availability-status.enum';

/**
 * Represents the normalized, server-validated structure of the query parameters
 * passed to `searchResponders`. This decouples the raw HTTP DTO (which contains
 * strings) from the strictly-typed database inputs.
 */
export interface NormalizedResponderFilter {
  status?: AccountStatusEnum[];
  availability?: AvailabilityStatusEnum[];
  agency?: AgencyTypeEnum[];
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  lastActiveFrom?: string;
  lastActiveTo?: string;
  onShift?: boolean;
  includeSoftDeleted: boolean;
  limit: number;
  cursor?: string;
}

@Injectable()
export class CommandCenterRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private readonly selectFields = `
    id, 
    name, 
    branch, 
    type, 
    json_build_object(
      'latitude', ST_Y(location::geometry),
      'longitude', ST_X(location::geometry)
    ) AS location,
    created_at
  `;

  /**
   * Inserts a new command center into the database.
   *
   * @param data - The core attributes of the command center (name, branch, type, location).
   * @returns The newly created `CommandCenterEntity`.
   */
  async createBranch(
    data: CreateCommandCenterData,
  ): Promise<CommandCenterEntity> {
    const { name, branch, type, location } = data;

    const sql = `
      INSERT INTO command_center (name, branch, type, location)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
      RETURNING ${this.selectFields};
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [
      name,
      branch,
      type,
      location.longitude,
      location.latitude,
    ]);

    return rows[0];
  }

  /**
   * Retrieves all command centers ordered by creation date (newest first).
   *
   * @returns An array of `CommandCenterEntity`.
   */
  async viewAll(): Promise<CommandCenterEntity[]> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      ORDER BY created_at DESC;
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql);
    return rows;
  }

  /**
   * Finds a single command center by its unique UUID.
   *
   * @param id - The UUID of the command center.
   * @returns The `CommandCenterEntity` or `null` if not found.
   */
  async findById(id: string): Promise<CommandCenterEntity | null> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      WHERE id = $1;
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [id]);
    return rows[0] || null;
  }

  /**
   * Performs a case-insensitive partial match search on the command center name.
   *
   * @param name - The string to search for.
   * @returns An array of matching `CommandCenterEntity` objects.
   */
  async findByName(name: string): Promise<CommandCenterEntity[]> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      WHERE name ILIKE '%' || $1 || '%';
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [name]);
    return rows;
  }

  /**
   * Performs a case-insensitive partial match search on the branch name.
   *
   * @param branch - The string to search for.
   * @returns An array of matching `CommandCenterEntity` objects.
   */
  async findByBranch(branch: string): Promise<CommandCenterEntity[]> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      WHERE branch ILIKE '%' || $1 || '%';
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [branch]);
    return rows;
  }

  /**
   * Updates fields of an existing command center. The SQL dynamically builds
   * the `SET` clause based on which properties are present in the payload.
   *
   * @param id - The UUID of the command center to update.
   * @param data - The partial payload of fields to update.
   * @returns The updated `CommandCenterEntity`, or `null` if it didn't exist.
   */
  async updateBranch(
    id: string,
    data: UpdateCommandCenterData,
  ): Promise<CommandCenterEntity | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${paramIdx++}`);
      values.push(data.name);
    }

    if (data.branch !== undefined) {
      fields.push(`branch = $${paramIdx++}`);
      values.push(data.branch);
    }

    if (data.type !== undefined) {
      fields.push(`type = $${paramIdx++}`);
      values.push(data.type);
    }

    if (data.location !== undefined) {
      fields.push(
        `location = ST_SetSRID(ST_MakePoint($${paramIdx++}, $${paramIdx++}), 4326)`,
      );
      values.push(data.location.longitude, data.location.latitude);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const sql = `
      UPDATE command_center
      SET ${fields.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING ${this.selectFields};
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, values);
    return rows[0] || null;
  }

  /**
   * Hard-deletes a command center from the database.
   *
   * @param id - The UUID of the command center.
   * @returns `true` if deleted, `false` if no rows were affected.
   */
  async deleteBranch(id: string): Promise<boolean> {
    const sql = `DELETE FROM command_center WHERE id = $1;`;
    const result = await this.db.query(sql, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Legacy: Fetches a paginated list of responders in a specific command center.
   * Excludes soft-deleted accounts. Relies on name-based cursor pagination.
   *
   * @param id - Command Center UUID.
   * @param limit - Number of records to return (default 20).
   * @param cursor - Base64 encoded tuple string `[l_name, f_name]`.
   * @returns Paginated `ResponderTableRow` array and a `nextCursor`.
   */
  async viewAllRespondersBranch(
    id: string,
    limit: number = 20,
    cursor: string | null = null,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    let query = `
      SELECT
       u.id,
       u.f_name,
       u.l_name,
       u.m_name,
       u.role,
       u.account_status,
       u.email,
       p.rank,
       p.agency,
       p.availability
     FROM user_account u
     JOIN r_profile p ON p.user_id = u.id
     WHERE u.command_center_id = $1
       AND u.role = $2
       AND u.deleted_at IS NULL
    `;

    const values: (string | number | Role)[] = [id, Role.RESPONDER];

    if (cursor) {
      query += ` AND (u.l_name, u.f_name) > ($3, $4)`;
      const [lastLName, lastFName] = JSON.parse(
        Buffer.from(cursor, 'base64').toString(),
      ) as [string, string];
      values.push(lastLName, lastFName);
    }

    query += ` ORDER BY u.l_name, u.f_name LIMIT $${values.length + 1}`;
    values.push(limit + 1);

    const { rows } = await this.db.query<ResponderTableRow>(query, values);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, -1) : rows;
    let nextCursor: string | null = null;

    if (hasMore && data.length > 0) {
      const lastItem = data[data.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify([lastItem.l_name, lastItem.f_name]),
      ).toString('base64');
    }

    return { data, nextCursor };
  }

  /**
   * Legacy: Fetches a paginated list of responders filtered by account status.
   * NOTE: Unlike `viewAllRespondersBranch`, this DOES include soft-deleted rows
   * (necessary to view 'deactivated' accounts where `deleted_at` is also set).
   *
   * @param id - Command Center UUID.
   * @param status - The specific account status to filter by.
   * @param limit - Number of records to return (default 20).
   * @param cursor - Base64 encoded tuple string `[l_name, f_name]`.
   * @returns Paginated `ResponderTableRow` array and a `nextCursor`.
   */
  async viewAllRespondersBasedOnStatusBranch(
    id: string,
    status: AccountStatusEnum,
    limit: number = 20,
    cursor: string | null = null,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    let query = `
      SELECT
       u.id,
       u.f_name,
       u.l_name,
       u.m_name,
       u.role,
       u.account_status,
       u.email,
       p.rank,
       p.agency,
       p.availability
     FROM user_account u
     JOIN r_profile p ON p.user_id = u.id
     WHERE u.command_center_id = $1
       AND u.role = $2
       AND u.account_status = $3
    `;

    const values: (string | number | Role | AccountStatusEnum)[] = [
      id,
      Role.RESPONDER,
      status,
    ];

    if (cursor) {
      query += ` AND (u.l_name, u.f_name) > ($4, $5)`;
      const [lastLName, lastFName] = JSON.parse(
        Buffer.from(cursor, 'base64').toString(),
      ) as [string, string];
      values.push(lastLName, lastFName);
    }

    query += ` ORDER BY u.l_name, u.f_name LIMIT $${values.length + 1}`;
    values.push(limit + 1);

    const { rows } = await this.db.query<ResponderTableRow>(query, values);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, -1) : rows;
    let nextCursor: string | null = null;

    if (hasMore && data.length > 0) {
      const lastItem = data[data.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify([lastItem.l_name, lastItem.f_name]),
      ).toString('base64');
    }

    return { data, nextCursor };
  }

  /**
   * Advanced filtering engine for responders in a specific command center.
   * Dynamically constructs a SQL query based on the provided filters (statuses,
   * availability, agencies, date ranges, shift state, and text search).
   *
   * @param centerId - Command Center UUID.
   * @param filter - The normalized object containing all active filters.
   * @returns Paginated `ResponderTableRow` array and a `nextCursor`.
   */
  async searchResponders(
    centerId: string,
    filter: NormalizedResponderFilter,
  ): Promise<{ data: ResponderTableRow[]; nextCursor: string | null }> {
    const params: unknown[] = [centerId, Role.RESPONDER];
    let paramIdx = 3;

    const clauses: string[] = [`u.command_center_id = $1`, `u.role = $2`];

    if (!filter.includeSoftDeleted) {
      clauses.push(`u.deleted_at IS NULL`);
    }

    if (filter.status && filter.status.length > 0) {
      clauses.push(
        `u.account_status = ANY($${paramIdx++}::account_status_enum[])`,
      );
      params.push(filter.status);
    }

    if (filter.availability && filter.availability.length > 0) {
      clauses.push(
        `p.availability = ANY($${paramIdx++}::availability_status[])`,
      );
      params.push(filter.availability);
    }

    if (filter.agency && filter.agency.length > 0) {
      clauses.push(`p.agency = ANY($${paramIdx++}::agency_type[])`);
      params.push(filter.agency);
    }

    const search = filter.search?.trim();
    if (search) {
      const escaped = search.replace(/[\\%_]/g, '\\$&');
      clauses.push(
        `(u.f_name ILIKE $${paramIdx}
          OR u.l_name ILIKE $${paramIdx}
          OR u.m_name ILIKE $${paramIdx}
          OR u.email   ILIKE $${paramIdx})`,
      );
      params.push(`%${escaped}%`);
      paramIdx++;
    }

    if (filter.createdFrom) {
      clauses.push(`u.created_at >= $${paramIdx++}`);
      params.push(filter.createdFrom);
    }
    if (filter.createdTo) {
      clauses.push(`u.created_at <= $${paramIdx++}`);
      params.push(filter.createdTo);
    }
    if (filter.updatedFrom) {
      clauses.push(`u.updated_at >= $${paramIdx++}`);
      params.push(filter.updatedFrom);
    }
    if (filter.updatedTo) {
      clauses.push(`u.updated_at <= $${paramIdx++}`);
      params.push(filter.updatedTo);
    }
    if (filter.lastActiveFrom) {
      clauses.push(`p.last_active_at >= $${paramIdx++}`);
      params.push(filter.lastActiveFrom);
    }
    if (filter.lastActiveTo) {
      clauses.push(`p.last_active_at <= $${paramIdx++}`);
      params.push(filter.lastActiveTo);
    }

    // A responder whose shift_ends_at is NULL is still on-duty (the timer
    // is set by the app when going on duty, but older code paths did not
    // always set it — see migrations 006 and 018). Treat NULL as "no end
    // yet" rather than "not on shift".
    if (filter.onShift === true) {
      clauses.push(
        `p.availability = 'on_duty' AND (p.shift_ends_at IS NULL OR p.shift_ends_at > now())`,
      );
    } else if (filter.onShift === false) {
      clauses.push(
        `NOT (p.availability = 'on_duty' AND (p.shift_ends_at IS NULL OR p.shift_ends_at > now()))`,
      );
    }

    if (filter.cursor) {
      const [lastLName, lastFName] = JSON.parse(
        Buffer.from(filter.cursor, 'base64').toString(),
      ) as [string, string];
      clauses.push(`(u.l_name, u.f_name) > ($${paramIdx++}, $${paramIdx++})`);
      params.push(lastLName, lastFName);
    }

    params.push(filter.limit + 1);
    const limitIdx = paramIdx;

    const sql = `
      SELECT
        u.id,
        u.f_name,
        u.l_name,
        u.m_name,
        u.role,
        u.account_status,
        u.email,
        p.rank,
        p.agency,
        p.availability
      FROM user_account u
      JOIN r_profile p ON p.user_id = u.id
      WHERE ${clauses.join('\n        AND ')}
      ORDER BY u.l_name, u.f_name
      LIMIT $${limitIdx}
    `;

    const { rows } = await this.db.query<ResponderTableRow>(sql, params);

    const hasMore = rows.length > filter.limit;
    const data = hasMore ? rows.slice(0, -1) : rows;
    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify([last.l_name, last.f_name]),
      ).toString('base64');
    }
    return { data, nextCursor };
  }

  /**
   * Retrieves a minimal list of users (Admins and Responders) within a specific
   * command center. Used to populate dropdown menus, such as the "Filter Actor"
   * selector in the audit logs UI.
   *
   * @param centerId - The UUID of the command center.
   * @returns An array of `ActorOption` objects (id and full name).
   */
  async findActorsInBranch(centerId: string): Promise<ActorOption[]> {
    const sql = `
      SELECT 
        id, 
        f_name || ' ' || l_name AS name
      FROM user_account
      WHERE command_center_id = $1
        AND role IN ('admin', 'responder')
        AND deleted_at IS NULL
      ORDER BY l_name, f_name;
    `;

    const { rows } = await this.db.query<ActorOption>(sql, [centerId]);
    return rows;
  }

  /**
   * Deactivates a responder by setting `account_status` to 'deactivated' and
   * `deleted_at` to now(). The `trg_revoke_sessions_on_deactivation` trigger
   * (013) revokes sessions and sets availability to off_duty in the same
   * transaction.
   *
   * pending_activation responders are excluded: they have no password and
   * cannot log in, so deactivating them is a no-op operationally; the
   * correct action is to delete/recreate them or use the activation email.
   *
   * @param id - Responder UUID.
   * @param commandCenterId - Command Center UUID (for scoping).
   * @returns `true` if a live responder was found and updated, `false` otherwise.
   */
  async deactivateResponder(
    id: string,
    commandCenterId: string,
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE user_account
       SET deleted_at = now(),
           account_status = 'deactivated'
       WHERE id = $1
         AND command_center_id = $2
         AND role = $3
         AND deleted_at IS NULL
         AND account_status <> 'pending_activation'
       RETURNING id`,
      [id, commandCenterId, Role.RESPONDER],
    );
    return rows.length > 0;
  }

  /**
   * Updates the email address of a responder. This is strictly limited to
   * accounts in the 'pending_activation' state so they can receive their
   * activation link at the correct address.
   *
   * @param id - Responder UUID.
   * @param email - The new email address.
   * @returns The previous email address (used for audit logging).
   * @throws BadRequestException on invalid input.
   * @throws NotFoundException if the account is not pending_activation.
   */
  async updateEmail(id: string, email: string): Promise<string> {
    if (!id || !email) {
      throw new BadRequestException('ID and email are required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    const sqlGetCurrent =
      'SELECT email FROM user_account WHERE id = $1 AND account_status = $2';
    const currentEmailResult = await this.db.query<{ email: string }>(
      sqlGetCurrent,
      [id, AccountStatusEnum.PENDING_ACTIVATION],
    );

    if (currentEmailResult.rowCount === 0) {
      throw new NotFoundException(
        `Responder with ID ${id} not found or not in pending_activation status`,
      );
    }

    const oldEmail = currentEmailResult.rows[0].email;

    const sqlUpdate =
      'UPDATE user_account SET email = $1 WHERE id = $2 AND account_status = $3';
    const updateResult = await this.db.query(sqlUpdate, [
      email,
      id,
      AccountStatusEnum.PENDING_ACTIVATION,
    ]);

    if (updateResult.rowCount === 0) {
      throw new NotFoundException(
        `Failed to update email for responder ID ${id}`,
      );
    }

    return oldEmail;
  }

  /**
   * Checks if a user exists and if the operation is happening within the same
   * branch. Used as a guard before performing mutative actions.
   *
   * @param id - Responder UUID.
   * @param command_center_id - Command Center UUID.
   * @returns The Responder UUID if found, otherwise `null`.
   */
  async findResponderInBranch(
    id: string,
    command_center_id: string,
  ): Promise<string | null> {
    const sql =
      'SELECT id FROM user_account WHERE id = $1 AND command_center_id = $2 AND role = $3';
    const result = await this.db.query<{ id: string }>(sql, [
      id,
      command_center_id,
      Role.RESPONDER,
    ]);
    return result.rows[0]?.id ?? null;
  }

  /**
   * Activates a deactivated responder by clearing `deleted_at` and setting
   * `account_status` back to 'active'. The `user_identity` trigger restores
   * their identities in the background.
   *
   * Requires `password_hash IS NOT NULL`: chck_auth_requirements (013) forces
   * active staff accounts to have a password, and a pending_activation
   * responder never got one. Attempting to activate such a row would trip
   * the CHECK; the WHERE clause simply excludes it so the caller gets a
   * clean "not found" instead of a 500.
   *
   * @param id - Responder UUID.
   * @param commandCenterId - Command Center UUID.
   * @returns `true` if found and restored, `false` otherwise.
   */
  async activateResponder(
    id: string,
    commandCenterId: string,
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE user_account
       SET deleted_at = NULL,
           account_status = 'active'
       WHERE id = $1
         AND command_center_id = $2
         AND role = $3
         AND deleted_at IS NOT NULL
         AND account_status = 'deactivated'
         AND password_hash IS NOT NULL
       RETURNING id`,
      [id, commandCenterId, Role.RESPONDER],
    );
    return rows.length > 0;
  }

  /**
   * Admin-forced password reset (compromise response). The service creates
   * the random token and passes only its hash. Re-issuing replaces any
   * unused token (the schema allows one live token per user and purpose).
   * Sessions are revoked in the same transaction.
   *
   * @param id - Responder UUID.
   * @param commandCenterId - Command Center UUID.
   * @param tokenHash - SHA-256 hash of the reset token.
   * @param expiresAt - Expiration timestamp for the token.
   * @returns An object containing the responder's email, or `null` if not found.
   */
  async setForForcedPasswordReset(
    id: string,
    commandCenterId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<{ email: string } | null> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; email: string }>(
        `SELECT id, email FROM user_account
       WHERE id = $1
         AND command_center_id = $2
         AND role = $3
         AND account_status = 'active'
         AND deleted_at IS NULL
       FOR UPDATE`,
        [id, commandCenterId, Role.RESPONDER],
      );
      const responder = rows[0];
      if (!responder) return null;

      await client.query(
        `INSERT INTO account_action_token (user_id, purpose, token_hash, expires_at)
       VALUES ($1, 'password_reset', $2, $3)
       ON CONFLICT (user_id, purpose) WHERE used_at IS NULL
       DO UPDATE SET token_hash = EXCLUDED.token_hash,
                     expires_at = EXCLUDED.expires_at,
                     created_at = now()`,
        [id, tokenHash, expiresAt],
      );

      await client.query(
        `UPDATE user_session SET is_revoked = true
       WHERE user_id = $1 AND is_revoked = false`,
        [id],
      );
      return { email: responder.email };
    });
  }

  /**
   * Signs the responder out everywhere by revoking all active sessions.
   *
   * @param id - Responder UUID.
   * @param commandCenterId - Command Center UUID.
   * @returns `true` if the responder exists and sessions were processed, `false` otherwise.
   */
  async setForSessionRevoke(
    id: string,
    commandCenterId: string,
  ): Promise<boolean> {
    const { rows } = await this.db.query<{ found: number }>(
      `WITH target AS (
       SELECT id FROM user_account
       WHERE id = $1
         AND command_center_id = $2
         AND role = $3
         AND deleted_at IS NULL
         AND account_status != 'deactivated'
     ),
     revoked AS (
       UPDATE user_session SET is_revoked = true
       WHERE user_id IN (SELECT id FROM target) AND is_revoked = false
     )
     SELECT count(*)::int AS found FROM target`,
      [id, commandCenterId, Role.RESPONDER],
    );
    return (rows[0]?.found ?? 0) > 0;
  }

  /**
   * Retrieves the role and branch scope of an actor. This is used by the
   * service layer to enforce Role-Based Access Control (RBAC) for branch-level
   * operations (e.g., ensuring an Admin can only manage their own center).
   *
   * @param userId - The UUID of the user performing the action.
   * @returns The role and command_center_id, or `null` if the user is deleted/not found.
   */
  async findActorScope(
    userId: string,
  ): Promise<{ role: Role; command_center_id: string | null } | null> {
    const { rows } = await this.db.query<{
      role: Role;
      command_center_id: string | null;
    }>(
      `SELECT role, command_center_id FROM user_account
     WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Reassigns a responder to a different command center (branch).
   * Only allowed if the responder is currently off_duty and belongs to
   * `currentCenterId`.
   *
   * Both the pre-check SELECT and the UPDATE run inside a single
   * transaction. `FOR UPDATE OF u, p` locks the responder row and their
   * r_profile row so a concurrent state change (going on duty,
   * deactivation, a competing reassignment) cannot slip between the
   * check and the write. The UPDATE's WHERE clause repeats the
   * preconditions as belt-and-suspenders; if a concurrent change
   * invalidated them, rowCount is 0 and we return null.
   *
   * Target command-center existence is checked by the caller (service);
   * a concurrent hard-delete of the target still fails the FK, which
   * surfaces as a 23503 and is mapped to a 409 by the service's
   * rethrow().
   *
   * @param responderId - The UUID of the responder to reassign.
   * @param currentCenterId - The responder's CURRENT command_center_id
   *   (also acts as a URL-path safety check).
   * @param targetCommandCenterId - The UUID of the target command center.
   * @returns The responder's previous command_center_id, or `null` if
   *   they weren't found / not off_duty / not in currentCenterId / lost a
   *   race condition.
   */
  async reassignResponderBranch(
    responderId: string,
    currentCenterId: string,
    targetCommandCenterId: string,
  ): Promise<string | null> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<{ command_center_id: string }>(
        `SELECT u.id, u.command_center_id
           FROM user_account u
           JOIN r_profile p ON p.user_id = u.id
           WHERE u.id = $1
             AND u.role = $2
             AND u.deleted_at IS NULL
             AND u.command_center_id = $3
             AND p.availability = $4
           FOR UPDATE OF u, p`,
        [
          responderId,
          Role.RESPONDER,
          currentCenterId,
          AvailabilityStatusEnum.OFF_DUTY,
        ],
      );
      const responder = rows[0];
      if (!responder) return null;

      // updated_at is maintained by trg_user_account_updated_at on every
      // UPDATE — no need to set it manually.
      const { rowCount } = await client.query(
        `UPDATE user_account u
            SET command_center_id = $1
          WHERE u.id = $2
            AND u.role = $3
            AND u.deleted_at IS NULL
            AND u.command_center_id = $4
            AND EXISTS (
              SELECT 1 FROM r_profile p
               WHERE p.user_id = u.id AND p.availability = $5
            )`,
        [
          targetCommandCenterId,
          responderId,
          Role.RESPONDER,
          currentCenterId,
          AvailabilityStatusEnum.OFF_DUTY,
        ],
      );

      if (rowCount !== 1) {
        // A concurrent change invalidated the preconditions between the
        // lock and the UPDATE. Treat it the same as "not eligible".
        return null;
      }

      return responder.command_center_id;
    });
  }
}
