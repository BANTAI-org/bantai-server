import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateCommandCenterData } from './types/create-command-center-data.types';
import { UpdateCommandCenterData } from './types/update-command-center-data.types';
import { CommandCenterEntity } from './interfaces/command-center.interface';
import { ResponderTableRow } from './interfaces/responder-tb.interface';

import { Role } from '../../common/enums/role-enum';
import { AccountStatusEnum } from '../../modules/auth/enums/account-status.enum';
@Injectable()
export class CommandCenterRepository {
  constructor(private readonly db: DatabaseService) {}

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

  async viewAll(): Promise<CommandCenterEntity[]> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      ORDER BY created_at DESC;
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql);
    return rows;
  }

  async findById(id: string): Promise<CommandCenterEntity | null> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      WHERE id = $1;
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [id]);
    return rows[0] || null;
  }

  async findByName(name: string): Promise<CommandCenterEntity[]> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      WHERE name ILIKE '%' || $1 || '%';
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [name]);
    return rows;
  }

  async findByBranch(branch: string): Promise<CommandCenterEntity[]> {
    const sql = `
      SELECT ${this.selectFields}
      FROM command_center
      WHERE branch ILIKE '%' || $1 || '%';
    `;

    const { rows } = await this.db.query<CommandCenterEntity>(sql, [branch]);
    return rows;
  }

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

  async deleteBranch(id: string): Promise<boolean> {
    const sql = `DELETE FROM command_center WHERE id = $1;`;
    const result = await this.db.query(sql, [id]);
    return (result.rowCount ?? 0) > 0;
  }

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
    values.push(limit + 1); // Get one extra to check if there are more

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
    values.push(limit + 1); // Get one extra to check if there are more

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
   * Deactivates a responder by setting account_status to 'deactivated' and
   * deleted_at to now(). The trg_revoke_sessions_on_soft_delete trigger revokes
   * the responder's sessions and sets availability to off_duty in the same
   * transaction.
   * Returns false if no live responder with that id exists in that branch.
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
     RETURNING id`,
      [id, commandCenterId, Role.RESPONDER],
    );
    return rows.length > 0;
  }

  /**
   * Activates a deactivated responder by setting deleted_at to NULL and
   * account_status to 'active'. The user_identity trigger restores
   * their identities too.
   * Returns false if no deactivated responder with that id exists in that branch.
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

  /** Signs the responder out everywhere. Returns false if not found in that branch. */
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
}
