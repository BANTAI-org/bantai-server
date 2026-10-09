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
  private readonly SELECT_PROJECTION = `
    id,
    actor_id AS "actorId",
    command_center_id AS "commandCenterId",
    action,
    target_entity AS "targetEntity",
    target_id AS "targetId",
    old_payload AS "oldPayload",
    new_payload AS "newPayload",
    created_at AS "createdAt"
  `;

  constructor(private readonly db: DatabaseService) {}

  async createAudit(data: CreateAuditLogInput): Promise<SystemAuditLogEntity> {
    const sql = `
      INSERT INTO system_audit_log (
        id,
        actor_id,
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
        $7::jsonb,
        $8::jsonb,
        COALESCE($9::timestamptz, now())
      )
      RETURNING ${this.SELECT_PROJECTION};
    `;

    const params: (string | null)[] = [
      data.id ?? null,
      data.actorId ?? null,
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
      FROM system_audit_log
      WHERE command_center_id = $1 AND id = $2
    `;
    const params: (string | Date)[] = [commandCenterId, id];

    if (createdAt) {
      sql += ` AND created_at = $3`;
      params.push(createdAt);
    }

    const result = await this.db.query<SystemAuditLogEntity>(sql, params);
    return result.rows[0] ?? null;
  }

  async getAll(params: GetAuditLogsParams): Promise<PaginatedAuditLogs> {
    const limit = params.limit ?? 20;
    const values: unknown[] = [params.commandCenterId, limit];
    let cursorCondition = '';

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

        cursorCondition = `AND (created_at, id) < ($3::timestamptz, $4::uuid)`;
        values.push(createdAt, id);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('Malformed cursor token');
      }
    }

    const sql = `
      SELECT ${this.SELECT_PROJECTION}
      FROM system_audit_log
      WHERE command_center_id = $1
      ${cursorCondition}
      ORDER BY created_at DESC, id DESC
      LIMIT $2;
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
