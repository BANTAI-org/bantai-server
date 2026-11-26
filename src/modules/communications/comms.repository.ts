import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { queryRows } from '../../common/utils/cursor-pagination-helper.util';
import { CommChannel } from './interfaces/comms-channel.interface';
import { CommMessage } from './interfaces/comms-message.interface';
import { CommRadioQueueView } from './interfaces/comms-radio-queue-view.interface';
import { CommParticipantRole } from './enums/comms-participant-role.enum';
import { Role } from '../../common/enums/role-enum';
import { ParticipantDto, ActiveChannelResponseDto } from './dto/comms.dto';

@Injectable()
export class CommsRepository {
  constructor(private readonly db: DatabaseService) {}

  // =====================================================================
  // CHANNELS
  // =====================================================================

  async findChannelByIncident(incidentId: string): Promise<CommChannel | null> {
    const [row] = await queryRows<CommChannel>(
      this.db,
      `SELECT * FROM comm_channel WHERE incident_id = $1::uuid AND status = 'active' LIMIT 1`,
      [incidentId],
    );
    return row || null;
  }

  async getChannelById(channelId: string): Promise<CommChannel | null> {
    const [row] = await queryRows<CommChannel>(
      this.db,
      `SELECT * FROM comm_channel WHERE id = $1::uuid LIMIT 1`,
      [channelId],
    );
    return row || null;
  }

  async createIncidentChannel(
    incidentId: string,
    name: string,
  ): Promise<string> {
    const [row] = await queryRows<{ id: string }>(
      this.db,
      `INSERT INTO comm_channel (incident_id, name) 
       VALUES ($1::uuid, $2) RETURNING id`,
      [incidentId, name],
    );
    return row.id;
  }

  // ADDED THIS:
  async updateCfMeetingId(
    channelId: string,
    cfMeetingId: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE comm_channel SET cf_meeting_id = $1 WHERE id = $2::uuid`,
      [cfMeetingId, channelId],
    );
  }

  async findActiveChannelByUser(
    userId: string,
  ): Promise<ActiveChannelResponseDto | null> {
    // ... (unchanged)
    const [row] = await queryRows<ActiveChannelResponseDto>(
      this.db,
      `SELECT 
         c.id AS channel_id,
         c.incident_id,
         c.name AS channel_name,
         i.status AS incident_status
       FROM comm_participant cp
       JOIN comm_channel c ON c.id = cp.channel_id
       JOIN incident i ON i.id = c.incident_id
       WHERE cp.user_id = $1::uuid
         AND cp.left_at IS NULL
         AND c.status = 'active'
         AND i.status NOT IN ('RESOLVED', 'CANCELLED')
       ORDER BY cp.joined_at DESC
       LIMIT 1`,
      [userId],
    );
    return row || null;
  }

  // =====================================================================
  // PERMISSIONS
  // =====================================================================

  async getIncidentCommsContext(incidentId: string): Promise<{
    driver_id: string | null;
    threat_category: string;
  } | null> {
    const [row] = await queryRows<{
      driver_id: string | null;
      threat_category: string;
    }>(
      this.db,
      `SELECT driver_id, threat_category FROM incident WHERE id = $1::uuid`,
      [incidentId],
    );
    return row || null;
  }

  async canUserCommunicate(
    incidentId: string,
    userId: string,
    userRole: Role,
  ): Promise<boolean> {
    if (['responder', 'admin', 'super'].includes(userRole)) {
      return true;
    }

    const [incident] = await queryRows<{ driver_id: string | null }>(
      this.db,
      `SELECT driver_id FROM incident WHERE id = $1::uuid`,
      [incidentId],
    );

    if (incident && incident.driver_id === userId) {
      return true;
    }

    const [row] = await queryRows<{ status: string }>(
      this.db,
      `SELECT status FROM incident_peer_response 
       WHERE incident_id = $1::uuid AND peer_driver_id = $2::uuid`,
      [incidentId, userId],
    );

    if (!row) return false;
    return ['en_route', 'on_scene'].includes(row.status);
  }

  async isParticipant(channelId: string, userId: string): Promise<boolean> {
    const [row] = await queryRows<{ exists: boolean }>(
      this.db,
      `SELECT EXISTS(
         SELECT 1 FROM comm_participant 
         WHERE channel_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL
       ) AS exists`,
      [channelId, userId],
    );
    return row?.exists ?? false;
  }

  // =====================================================================
  // PARTICIPANTS
  // =====================================================================

  async addParticipant(
    channelId: string,
    userId: string,
    role: CommParticipantRole,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO comm_participant (channel_id, user_id, role)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (channel_id, user_id) 
       DO UPDATE SET left_at = NULL, role = EXCLUDED.role`,
      [channelId, userId, role],
    );
  }

  async removeParticipant(channelId: string, userId: string): Promise<void> {
    await this.db.query(
      `UPDATE comm_participant SET left_at = now() WHERE channel_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL`,
      [channelId, userId],
    );
  }

  async getParticipants(channelId: string): Promise<ParticipantDto[]> {
    return queryRows<ParticipantDto>(
      this.db,
      `SELECT
         u.id,
         TRIM(u.f_name || ' ' || u.l_name) AS name,
         u.avatar_url,
         cp.role,
         cp.joined_at,
         dp.service_provider,
         dp.service_id,
         rp.rank,
         rp.agency,
         cc.id AS command_center_id,
         cc.name AS command_center_name
       FROM comm_participant cp
       JOIN user_account u ON u.id = cp.user_id
       LEFT JOIN d_profile dp ON dp.user_id = u.id
       LEFT JOIN r_profile rp ON rp.user_id = u.id
       LEFT JOIN command_center cc ON cc.id = u.command_center_id
       WHERE cp.channel_id = $1::uuid
         AND cp.left_at IS NULL
       ORDER BY cp.joined_at ASC`,
      [channelId],
    );
  }

  // =====================================================================
  // RADIO QUEUE (PUSH-TO-TALK)
  // =====================================================================

  async requestMicAtomic(
    channelId: string,
    userId: string,
    priority: number,
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        channelId,
      ]);

      const speaker = await client.query(
        `SELECT id FROM comm_radio_queue WHERE channel_id = $1::uuid AND status = 'speaking' LIMIT 1`,
        [channelId],
      );

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO comm_radio_queue (channel_id, user_id, priority)
         VALUES ($1::uuid, $2::uuid, $3)
         RETURNING id`,
        [channelId, userId, priority],
      );

      if (speaker.rowCount === 0) {
        await client.query(
          `UPDATE comm_radio_queue 
           SET status = 'speaking', started_speaking_at = now() 
           WHERE id = $1::uuid`,
          [rows[0].id],
        );
      }
    });
  }

  async releaseMicAtomic(channelId: string, queueId: string): Promise<void> {
    await this.db.withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        channelId,
      ]);

      await client.query(
        `UPDATE comm_radio_queue 
         SET status = 'completed', ended_speaking_at = now() 
         WHERE id = $1::uuid AND channel_id = $2::uuid`,
        [queueId, channelId],
      );

      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM comm_radio_queue 
         WHERE channel_id = $1::uuid AND status = 'requested'
         ORDER BY priority DESC, requested_at ASC LIMIT 1`,
        [channelId],
      );

      if (rows.length > 0) {
        await client.query(
          `UPDATE comm_radio_queue 
           SET status = 'speaking', started_speaking_at = now() 
           WHERE id = $1::uuid`,
          [rows[0].id],
        );
      }
    });
  }

  async getRadioQueue(channelId: string): Promise<CommRadioQueueView[]> {
    return queryRows<CommRadioQueueView>(
      this.db,
      `SELECT * FROM comm_radio_queue_view WHERE channel_id = $1::uuid`,
      [channelId],
    );
  }

  // =====================================================================
  // TEXT MESSAGES
  // =====================================================================

  async saveMessage(
    channelId: string,
    senderId: string,
    content: string,
  ): Promise<CommMessage> {
    const [row] = await queryRows<CommMessage>(
      this.db,
      `INSERT INTO comm_message (channel_id, sender_id, content, type)
       VALUES ($1::uuid, $2::uuid, $3, 'text')
       RETURNING *`,
      [channelId, senderId, content],
    );
    return row;
  }

  async getMessageHistory(
    channelId: string,
    limit: number = 50,
  ): Promise<CommMessage[]> {
    return queryRows<CommMessage>(
      this.db,
      `SELECT * FROM comm_message WHERE channel_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
      [channelId, limit],
    );
  }

  async isAdminAuthorizedForIncident(
    incidentId: string,
    adminId: string,
  ): Promise<boolean> {
    const [row] = await queryRows<{ is_authorized: boolean }>(
      this.db,
      `SELECT EXISTS (
         SELECT 1
         FROM incident i
         LEFT JOIN user_account claimant ON claimant.id = i.claimed_by_id
         WHERE i.id = $1::uuid
           AND (
             -- Condition A: The claimant belongs to the same Command Center as the Admin
             claimant.command_center_id = (SELECT command_center_id FROM user_account WHERE id = $2::uuid)
             OR
             -- Condition B: The incident was escalated to the Admin's Command Center
             EXISTS (
               SELECT 1 FROM incident_escalation e
               WHERE e.incident_id = i.id
                 AND e.command_center_id = (SELECT command_center_id FROM user_account WHERE id = $2::uuid)
             )
           )
       ) AS is_authorized`,
      [incidentId, adminId],
    );
    return row?.is_authorized ?? false;
  }
}
