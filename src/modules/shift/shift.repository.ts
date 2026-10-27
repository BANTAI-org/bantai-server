import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { queryRows } from '../../common/utils/cursor-pagination-helper.util';

interface ExpiredRow {
  user_id: string;
}

interface EndingSoonRow {
  user_id: string;
  shift_ends_at: Date;
}

@Injectable()
export class ShiftRepository {
  constructor(private readonly db: DatabaseService) {}

  // ==================================================================
  // Sweep queries — aligned with the partial indexes from 006/007
  // ==================================================================

  async findExpiredResponderIds(limit: number): Promise<string[]> {
    const rows = await queryRows<ExpiredRow>(
      this.db,
      `SELECT user_id
         FROM r_profile
        WHERE availability = 'on_duty'
          AND shift_ends_at IS NOT NULL
          AND shift_ends_at <= NOW()
        ORDER BY shift_ends_at ASC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.user_id);
  }

  async findExpiredDriverIds(limit: number): Promise<string[]> {
    const rows = await queryRows<ExpiredRow>(
      this.db,
      `SELECT user_id
         FROM d_profile
        WHERE duty_status = 'on_duty'
          AND shift_ends_at IS NOT NULL
          AND shift_ends_at <= NOW()
        ORDER BY shift_ends_at ASC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.user_id);
  }

  async findEndingSoonResponderIds(
    withinMinutes: number,
    limit: number,
  ): Promise<EndingSoonRow[]> {
    return queryRows<EndingSoonRow>(
      this.db,
      `SELECT user_id, shift_ends_at
         FROM r_profile
        WHERE availability = 'on_duty'
          AND shift_ends_at IS NOT NULL
          AND shift_ends_at > NOW()
          AND shift_ends_at <= NOW() + make_interval(mins => $1)
        ORDER BY shift_ends_at ASC
        LIMIT $2`,
      [withinMinutes, limit],
    );
  }

  async findEndingSoonDriverIds(
    withinMinutes: number,
    limit: number,
  ): Promise<EndingSoonRow[]> {
    return queryRows<EndingSoonRow>(
      this.db,
      `SELECT user_id, shift_ends_at
         FROM d_profile
        WHERE duty_status = 'on_duty'
          AND shift_ends_at IS NOT NULL
          AND shift_ends_at > NOW()
          AND shift_ends_at <= NOW() + make_interval(mins => $1)
        ORDER BY shift_ends_at ASC
        LIMIT $2`,
      [withinMinutes, limit],
    );
  }

  // ==================================================================
  // Bulk expiry — UPDATE + audit + inbox in one transaction
  // ==================================================================

  /**
   * Expires responder shifts in one transaction with the audit row and
   * the notification row. Returns ONLY the user_ids that were actually
   * flipped (a racing instance may have expired some first — the WHERE
   * guard 'availability = on_duty AND shift_ends_at <= NOW()' makes the
   * UPDATE skip already-expired rows, so RETURNING is correct).
   *
   * FCM is emitted by the service after commit with skipInbox: true,
   * matching the pattern used for report reviews.
   */
  async expireResponderShiftsBulk(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    return this.db.withTransaction(async (client) => {
      const { rows: updated } = await client.query<{ user_id: string }>(
        `UPDATE r_profile
            SET availability = 'off_duty',
                shift_ends_at = NULL,
                updated_at = now()
          WHERE user_id = ANY($1::uuid[])
            AND availability = 'on_duty'
            AND shift_ends_at IS NOT NULL
            AND shift_ends_at <= NOW()
          RETURNING user_id`,
        [userIds],
      );
      if (updated.length === 0) return [];
      const expiredUserIds = updated.map((r) => r.user_id);

      // Audit — one row per responder. actor_id NULL = "the system did this"
      // (convention from migration 001). command_center_id is carried because
      // the CC admin's logs view may want to see it.
      await client.query(
        `INSERT INTO system_audit_log
           (actor_id, command_center_id, action, target_entity, target_id,
            old_payload, new_payload)
         SELECT NULL, ua.command_center_id, 'AUTO_EXPIRE_SHIFT',
                'r_profile', u.user_id,
                '{"availability":"on_duty"}'::jsonb,
                '{"availability":"off_duty","reason":"shift_expired"}'::jsonb
           FROM unnest($1::uuid[]) AS u(user_id)
           LEFT JOIN user_account ua ON ua.id = u.user_id`,
        [expiredUserIds],
      );

      // Durable inbox row. related_entity = 'shift' is a convention, not an
      // enum; the client routes on `type` and knows 'shift' rows have no
      // entity to fetch (related_entity_id is just the user_id for traceability).
      await client.query(
        `INSERT INTO notification
           (user_id, type, tone, title, body, related_entity, related_entity_id)
         SELECT u.user_id, 'shift_auto_ended', 'info',
                'Shift ended',
                'Your shift has ended automatically. You are now off duty.',
                'shift', u.user_id
           FROM unnest($1::uuid[]) AS u(user_id)`,
        [expiredUserIds],
      );

      return expiredUserIds;
    });
  }

  async expireDriverShiftsBulk(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    return this.db.withTransaction(async (client) => {
      const { rows: updated } = await client.query<{ user_id: string }>(
        `UPDATE d_profile
            SET duty_status = 'off_duty',
                shift_ends_at = NULL,
                updated_at = now()
          WHERE user_id = ANY($1::uuid[])
            AND duty_status = 'on_duty'
            AND shift_ends_at IS NOT NULL
            AND shift_ends_at <= NOW()
          RETURNING user_id`,
        [userIds],
      );
      if (updated.length === 0) return [];
      const expiredUserIds = updated.map((r) => r.user_id);

      // Drivers never have a command_center_id (chck_auth_requirements).
      await client.query(
        `INSERT INTO system_audit_log
           (actor_id, command_center_id, action, target_entity, target_id,
            old_payload, new_payload)
         SELECT NULL, NULL, 'AUTO_EXPIRE_SHIFT', 'd_profile', u.user_id,
                '{"duty_status":"on_duty"}'::jsonb,
                '{"duty_status":"off_duty","reason":"shift_expired"}'::jsonb
           FROM unnest($1::uuid[]) AS u(user_id)`,
        [expiredUserIds],
      );

      await client.query(
        `INSERT INTO notification
           (user_id, type, tone, title, body, related_entity, related_entity_id)
         SELECT u.user_id, 'shift_auto_ended', 'info',
                'Shift ended',
                'Your shift has ended automatically. You are now off duty.',
                'shift', u.user_id
           FROM unnest($1::uuid[]) AS u(user_id)`,
        [expiredUserIds],
      );

      return expiredUserIds;
    });
  }

  // ==================================================================
  // Read / extend
  // ==================================================================

  async findResponderShiftStatus(
    userId: string,
  ): Promise<{ availability: string; shift_ends_at: Date | null } | null> {
    const rows = await queryRows<{
      availability: string;
      shift_ends_at: Date | null;
    }>(
      this.db,
      `SELECT availability, shift_ends_at
         FROM r_profile
        WHERE user_id = $1::uuid`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async findDriverShiftStatus(
    userId: string,
  ): Promise<{ duty_status: string; shift_ends_at: Date | null } | null> {
    const rows = await queryRows<{
      duty_status: string;
      shift_ends_at: Date | null;
    }>(
      this.db,
      `SELECT duty_status, shift_ends_at
         FROM d_profile
        WHERE user_id = $1::uuid`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async extendResponderShift(
    userId: string,
    minutes: number,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE r_profile
          SET shift_ends_at = GREATEST(shift_ends_at, now())
                              + make_interval(mins => $2),
              updated_at = now()
        WHERE user_id = $1::uuid
          AND availability = 'on_duty'
          AND shift_ends_at IS NOT NULL`,
      [userId, minutes],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async extendDriverShift(userId: string, minutes: number): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE d_profile
          SET shift_ends_at = GREATEST(shift_ends_at, now())
                              + make_interval(mins => $2),
              updated_at = now()
        WHERE user_id = $1::uuid
          AND duty_status = 'on_duty'
          AND shift_ends_at IS NOT NULL`,
      [userId, minutes],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
