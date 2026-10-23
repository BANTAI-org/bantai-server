import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { queryRows } from '../../common/utils/cursor-pagination-helper.util';

export interface NotificationRow {
  id: string;
  type: string;
  tone: string;
  title: string;
  body: string;
  related_entity: string | null;
  related_entity_id: string | null;
  read_at: Date | null;
  created_at: Date;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Registers or updates an FCM token for a user.
   * ON CONFLICT handles token refreshing or switching accounts on the same device.
   */
  async registerToken(
    userId: string,
    fcmToken: string,
    deviceType: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO user_device_token (user_id, fcm_token, device_type)
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT (fcm_token) 
       DO UPDATE SET 
         user_id = EXCLUDED.user_id, 
         last_updated_at = now()`,
      [userId, fcmToken, deviceType],
    );
  }

  /**
   * Fetches a user's notification history (newest first).
   */
  async getNotifications(
    userId: string,
    limit = 50,
    beforeDate?: Date,
  ): Promise<NotificationRow[]> {
    let query = `
      SELECT id, type, tone, title, body, related_entity, related_entity_id, read_at, created_at
      FROM notification
      WHERE user_id = $1::uuid
    `;
    const params: unknown[] = [userId];

    if (beforeDate) {
      params.push(beforeDate);
      query += ` AND created_at < $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    return queryRows<NotificationRow>(this.db, query, params);
  }

  /**
   * Marks a specific notification as read.
   */
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE notification SET read_at = now()
       WHERE id = $1::uuid AND user_id = $2::uuid AND read_at IS NULL`,
      [notificationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Deletes a notification permanently.
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM notification WHERE id = $1::uuid AND user_id = $2::uuid`,
      [notificationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Fetches all active FCM tokens for a user.
   */
  async getUserTokens(userId: string): Promise<string[]> {
    const rows = await queryRows<{ fcm_token: string }>(
      this.db,
      `SELECT fcm_token FROM user_device_token WHERE user_id = $1::uuid`,
      [userId],
    );
    return rows.map((r) => r.fcm_token);
  }

  /**
   * Cleans up dead tokens (called when FCM says the token is unregistered).
   */
  async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.query(
      `DELETE FROM user_device_token WHERE fcm_token = ANY($1::text[])`,
      [tokens],
    );
  }
}
