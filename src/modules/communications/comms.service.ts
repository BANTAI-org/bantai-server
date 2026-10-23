import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommsRepository } from './comms.repository';
import { RealtimeKitService } from './realtimekit.service';
import { CommParticipantRole } from './enums/comms-participant-role.enum';
import { CommRadioStatus } from './enums/comms-radio-status.enum';
import { Role } from '../../common/enums/role-enum';
import { CommsEvents } from './comms.gateway';
import { CommMessage } from './interfaces/comms-message.interface';

@Injectable()
export class CommsService {
  constructor(
    private readonly repo: CommsRepository,
    private readonly realtimeKit: RealtimeKitService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * @description
   * Handles a user joining a tactical channel.
   * Validates the channel exists, adds the user to the database, and generates
   * a secure Cloudflare RealtimeKit token so the Flutter app can connect to the WebRTC audio room.
   *
   * @param {string} incidentId - The UUID of the incident.
   * @param {string} userId - The UUID of the user joining.
   * @param {Role} userRole - The system role of the user (Driver, Responder, Admin).
   * @param {string} displayName - The name/callsign to display in the UI.
   * @returns {Promise<{ channelId: string; authToken: string }>} The channel ID and RealtimeKit auth token.
   * @throws {NotFoundException} If there is no active comms channel for this incident.
   */
  async joinChannel(
    incidentId: string,
    userId: string,
    userRole: Role,
    displayName: string,
  ): Promise<{ channelId: string; authToken: string }> {
    const channel = await this.repo.findChannelByIncident(incidentId);
    if (!channel) {
      throw new NotFoundException('No active comms channel for this incident');
    }

    // Map system Role to Comms Participant Role
    let commsRole = CommParticipantRole.PEER;
    if (userRole === Role.RESPONDER) {
      commsRole = CommParticipantRole.RESPONDER;
    }
    if (userRole === Role.ADMIN || userRole === Role.SUPER) {
      commsRole = CommParticipantRole.DISPATCHER;
    }

    // Register in Postgres
    await this.repo.addParticipant(channel.id, userId, commsRole);

    // Generate Cloudflare RealtimeKit token (using channel.id as meetingId)
    const authToken = await this.realtimeKit.generateParticipantToken(
      channel.id,
      userId,
      displayName,
    );

    return { channelId: channel.id, authToken };
  }

  /**
   * @description
   * Handles a user requesting the Push-to-Talk microphone.
   * Assigns a priority based on the user's role. If the room is silent,
   * the user is granted the mic immediately. Otherwise, they are added to the queue.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} userId - The UUID of the user requesting the mic.
   * @param {Role} userRole - The system role of the user (used to calculate priority).
   * @returns {Promise<void>}
   */
  async requestMic(
    channelId: string,
    userId: string,
    userRole: Role,
  ): Promise<void> {
    const currentSpeaker = await this.repo.getCurrentSpeaker(channelId);

    // Responders and Dispatchers get priority 100, Peers get 10
    const isResponder =
      userRole === Role.RESPONDER ||
      userRole === Role.ADMIN ||
      userRole === Role.SUPER;
    const priority = isResponder ? 100 : 10;

    // Insert into queue
    const queueId = await this.repo.requestMic(channelId, userId, priority);

    // If no one is speaking, grant immediately
    if (!currentSpeaker) {
      await this.repo.updateRadioStatus(queueId, CommRadioStatus.SPEAKING);
    }

    // Broadcast the updated queue to all clients
    await this.emitQueueUpdate(channelId);
  }

  /**
   * @description
   * Handles a user releasing the microphone.
   * Marks their queue entry as 'completed' and automatically grants the mic
   * to the next highest-priority person waiting in the queue.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} queueId - The UUID of the specific queue entry being released.
   * @returns {Promise<void>}
   */
  async releaseMic(channelId: string, queueId: string): Promise<void> {
    // Mark current speaker as done
    await this.repo.updateRadioStatus(queueId, CommRadioStatus.COMPLETED);

    // The view sorts by 'speaking' first, then priority DESC, then requested_at ASC.
    // Since we just completed the speaker, the next person is now at index 0.
    const queue = await this.repo.getRadioQueue(channelId);

    // If there's someone next in line, grant them the mic
    if (queue.length > 0) {
      const nextInLine = queue[0];
      await this.repo.updateRadioStatus(
        nextInLine.queue_id,
        CommRadioStatus.SPEAKING,
      );
    }

    // Broadcast the updated queue to all clients
    await this.emitQueueUpdate(channelId);
  }

  /**
   * @description
   * Saves a text message to the database and broadcasts it
   * to all participants in the channel via WebSockets.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {string} senderId - The UUID of the user sending the message.
   * @param {string} content - The text content of the message.
   * @returns {Promise<CommMessage>} The saved message object.
   */
  async sendMessage(
    channelId: string,
    senderId: string,
    content: string,
  ): Promise<CommMessage> {
    const message = await this.repo.saveMessage(channelId, senderId, content);

    // Broadcast to WebSocket
    this.events.emit(CommsEvents.MESSAGE_NEW, { channelId, message });
    return message;
  }

  /**
   * @description
   * Retrieves the chat history for a specific channel.
   *
   * @param {string} channelId - The UUID of the channel.
   * @param {number} [limit=50] - Maximum number of messages to return.
   * @returns {Promise<CommMessage[]>} An array of past messages.
   */
  async getMessageHistory(
    channelId: string,
    limit?: number,
  ): Promise<CommMessage[]> {
    return this.repo.getMessageHistory(channelId, limit);
  }

  /**
   * @description
   * Internal helper that fetches the latest queue from the database
   * and emits an event for the Gateway to broadcast to WebSocket clients.
   *
   * @param {string} channelId - The UUID of the channel.
   * @returns {Promise<void>}
   */
  private async emitQueueUpdate(channelId: string): Promise<void> {
    const queue = await this.repo.getRadioQueue(channelId);
    this.events.emit(CommsEvents.QUEUE_UPDATED, { channelId, queue });
  }
}
