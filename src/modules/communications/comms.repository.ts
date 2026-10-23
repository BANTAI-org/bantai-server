import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { queryRows } from '../../common/utils/cursor-pagination-helper.util';
import { CommChannel } from './interfaces/comms-channel.interface';
import { CommMessage } from './interfaces/comms-message.interface';
import { CommRadioQueueView } from './interfaces/comms-radio-queue-view.interface';
import { CommParticipantRole } from './enums/comms-participant-role.enum';
import { CommRadioStatus } from './enums/comms-radio-status.enum';
import { Role } from '../../common/enums/role-enum';

@Injectable()
export class CommsRepository {
  constructor(private readonly db: DatabaseService) {}

  // =====================================================================
  // CHANNELS
  // =====================================================================

  /**
   * @description
   * Finds the active communications channel associated with a specific incident.
   */
  async findChannelByIncident(incidentId: string): Promise<CommChannel | null> {
    const [row] = await queryRows<CommChannel>(
      this.db,
      `SELECT * FROM comm_channel WHERE incident_id = $1::uuid AND status = 'active' LIMIT 1`,
      [incidentId],
    );
    return row || null;
  }

  /**
   * @description
   * Finds a channel by its direct UUID (used for permission checks).
   */
  async getChannelById(channelId: string): Promise<CommChannel | null> {
    const [row] = await queryRows<CommChannel>(
      this.db,
      `SELECT * FROM comm_channel WHERE id = $1::uuid LIMIT 1`,
      [channelId],
    );
    return row || null;
  }

  /**
   * @description
   * Creates a new communications channel for an incident.
   * Triggered automatically when an incident is created.
   */
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

  // =====================================================================
  // PERMISSIONS
  // =====================================================================

  /**
   * @description
   * Checks if a user is authorized to communicate (send text/voice) in an incident.
   * Responders/Admins are always allowed.
   * Peers are ONLY allowed if they are en_route or on_scene.
   */
  async canUserCommunicate(
    incidentId: string,
    userId: string,
    userRole: Role,
  ): Promise<boolean> {
    if (['responder', 'admin', 'super'].includes(userRole)) {
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
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, userId, role],
    );
  }

  async removeParticipant(channelId: string, userId: string): Promise<void> {
    await this.db.query(
      `UPDATE comm_participant SET left_at = now() WHERE channel_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL`,
      [channelId, userId],
    );
  }

  // =====================================================================
  // RADIO QUEUE (PUSH-TO-TALK)
  // =====================================================================

  async requestMic(
    channelId: string,
    userId: string,
    priority: number,
  ): Promise<string> {
    const [row] = await queryRows<{ id: string }>(
      this.db,
      `INSERT INTO comm_radio_queue (channel_id, user_id, priority)
       VALUES ($1::uuid, $2::uuid, $3)
       RETURNING id`,
      [channelId, userId, priority],
    );
    return row.id;
  }

  async getRadioQueue(channelId: string): Promise<CommRadioQueueView[]> {
    return queryRows<CommRadioQueueView>(
      this.db,
      `SELECT * FROM comm_radio_queue_view WHERE channel_id = $1::uuid`,
      [channelId],
    );
  }

  async updateRadioStatus(
    queueId: string,
    status: CommRadioStatus,
  ): Promise<void> {
    let timestampUpdate = '';
    if (status === CommRadioStatus.SPEAKING) {
      timestampUpdate = ', started_speaking_at = now()';
    }
    if (status === CommRadioStatus.COMPLETED) {
      timestampUpdate = ', ended_speaking_at = now()';
    }

    await this.db.query(
      `UPDATE comm_radio_queue SET status = $1::comm_radio_status ${timestampUpdate} WHERE id = $2::uuid`,
      [status, queueId],
    );
  }

  async getCurrentSpeaker(
    channelId: string,
  ): Promise<CommRadioQueueView | null> {
    const [row] = await queryRows<CommRadioQueueView>(
      this.db,
      `SELECT * FROM comm_radio_queue_view WHERE channel_id = $1::uuid AND status = 'speaking' LIMIT 1`,
      [channelId],
    );
    return row || null;
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
}
