import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateAuditLogInput } from './types/create-audit.type';
import { SystemAuditLogEntity } from './interfaces/system-audit-logs-entity.interface';
import { AuditCursor } from './interfaces/audit-cursor.interface';
import { PaginatedAuditLogs } from './interfaces/paginated-audit-logs.interface';
import { GetAuditLogsParams } from './interfaces/get-audit-logs-params.interface';
import { commandCenterId } from './types/command-center-id.types';

@Injectable()
export class AuditLogsRepository {
  // Note: We prefix columns with 'sal' (system_audit_log) to avoid ambiguity with the joined table
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

  async getAll(params: GetAuditLogsParams): Promise<PaginatedAuditLogs> {
    const limit = params.limit ?? 20;
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

  async getCommandCenterIdOnId(id: string): Promise<string> {
    const sql = 'SELECT id FROM command_center WHERE id = $1';
    const result = await this.db.query<commandCenterId>(sql, [id]);
    return result.rows[0]?.id;
  }
}
