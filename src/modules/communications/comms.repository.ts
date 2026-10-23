import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { queryRows } from '../../common/utils/cursor-pagination-helper.util';
import { CommChannel } from './interfaces/comms-channel.interface';
import { CommMessage } from './interfaces/comms-message.interface';
import { CommRadioQueueView } from './interfaces/comms-radio-queue-view.interface';
import { CommParticipantRole } from './enums/comms-participant-role.enum';
import { CommRadioStatus } from './enums/comms-radio-status.enum';

@Injectable()
export class CommsRepository {
  constructor(private readonly db: DatabaseService) {}

  // =====================================================================
  // CHANNELS
  // =====================================================================

  /**
   * @description
   * Finds the active communications channel associated with a specific incident.
   * If an incident is resolved, the channel is archived, so this will return null.
   *
   * @param {string} incidentId - The UUID of the incident.
   * @returns {Promise<CommChannel | null>} The active channel, or null if not found.
   */
  async findChannelByIncident(incidentId: string): Promise<CommChannel | null> {
    const [row] = await queryRows<CommChannel>(
      this.db,
      `SELECT * FROM comm_channel WHERE incident_id = $1::uuid AND status = 'active' LIMIT 1`,
      [incidentId],
    );
    return row || null;
  }

  // =====================================================================
  // PARTICIPANTS
  // =====================================================================

  /**
   * @description
   * Adds a user to the active communications channel.
   * Uses `ON CONFLICT DO NOTHING` so if a user refreshes their app and rejoins,
   * it does not throw a database constraint error.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} userId - The UUID of the user joining.
   * @param {CommParticipantRole} role - The user's role (peer, responder, dispatcher).
   * @returns {Promise<void>}
   */
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

  /**
   * @description
   * Marks a user as having left the channel by stamping `left_at` with the current time.
   * We do not hard delete the row because we want to keep an audit trail of who was in the room.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} userId - The UUID of the user leaving.
   * @returns {Promise<void>}
   */
  async removeParticipant(channelId: string, userId: string): Promise<void> {
    await this.db.query(
      `UPDATE comm_participant SET left_at = now() WHERE channel_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL`,
      [channelId, userId],
    );
  }

  // =====================================================================
  // RADIO QUEUE (PUSH-TO-TALK)
  // =====================================================================

  /**
   * @description
   * Inserts a user into the Push-to-Talk queue.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} userId - The UUID of the user requesting the mic.
   * @param {number} priority - The priority level (Responders: 100, Peers: 10).
   * @returns {Promise<string>} The UUID of the newly created queue entry.
   */
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

  /**
   * @description
   * Fetches the current Push-to-Talk queue using the Postgres `comm_radio_queue_view`.
   * The view automatically handles sorting: the current speaker is always #1,
   * followed by the highest priority, then whoever requested first.
   *
   * @param {string} channelId - The UUID of the channel.
   * @returns {Promise<CommRadioQueueView[]>} The sorted queue with user details (name, agency).
   */
  async getRadioQueue(channelId: string): Promise<CommRadioQueueView[]> {
    return queryRows<CommRadioQueueView>(
      this.db,
      `SELECT * FROM comm_radio_queue_view WHERE channel_id = $1::uuid`,
      [channelId],
    );
  }

  /**
   * @description
   * Updates the status of a specific user in the queue (e.g., 'speaking', 'completed').
   * Dynamically adds the correct timestamp (`started_speaking_at` or `ended_speaking_at`)
   * based on the status provided.
   *
   * @param {string} queueId - The UUID of the specific queue entry.
   * @param {CommRadioStatus} status - The new status.
   * @returns {Promise<void>}
   */
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

  /**
   * @description
   * Checks if anyone is currently holding the microphone in the channel.
   * Used to determine if a new requester should be granted the mic immediately
   * or put in the waiting queue.
   *
   * @param {string} channelId - The UUID of the channel.
   * @returns {Promise<CommRadioQueueView | null>} The active speaker, or null if the room is silent.
   */
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

  /**
   * @description
   * Persists a new text message to the database.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} senderId - The UUID of the user sending the message.
   * @param {string} content - The actual text content.
   * @returns {Promise<CommMessage>} The fully saved message object (including ID and timestamp).
   */
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

  /**
   * @description
   * Retrieves the chat history for a channel, ordered from newest to oldest.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {number} [limit=50] - The maximum number of messages to return.
   * @returns {Promise<CommMessage[]>} An array of chat messages.
   */
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
