import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { CommsRepository } from './comms.repository';
import { RealtimeKitService } from './realtimekit.service';
import { CommParticipantRole } from './enums/comms-participant-role.enum';
import { CommRadioStatus } from './enums/comms-radio-status.enum';
import { Role } from '../../common/enums/role-enum';
import { CommsEvents } from './comms.gateway';
import type { CommMessage } from './interfaces/comms-message.interface';
import { IncidentEvents } from '../incidents/events/incident-events';
import type { IncidentCreatedEvent } from '../incidents/events/incident-events';

@Injectable()
export class CommsService {
  constructor(
    private readonly repo: CommsRepository,
    private readonly realtimeKit: RealtimeKitService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * @description
   * Automatically spawns a communications channel when an incident is created.
   * Creates the channel in Postgres and initializes the WebRTC room in Cloudflare.
   */
  @OnEvent(IncidentEvents.CREATED)
  async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
    const channelName = `Incident ${event.incidentId.substring(0, 8)} - ${event.threatType}`;

    // 1. Create in Postgres
    await this.repo.createIncidentChannel(event.incidentId, channelName);

    // 2. Create in Cloudflare RealtimeKit
    await this.realtimeKit.createMeeting(channelName);
  }

  /**
   * @description
   * Handles a user joining the tactical channel for an incident.
   * Returns the channelId and the RealtimeKit authToken for WebRTC.
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

    let commsRole = CommParticipantRole.PEER;
    if (userRole === Role.RESPONDER) {
      commsRole = CommParticipantRole.RESPONDER;
    }
    if (userRole === Role.ADMIN || userRole === Role.SUPER) {
      commsRole = CommParticipantRole.DISPATCHER;
    }

    await this.repo.addParticipant(channel.id, userId, commsRole);

    const authToken = await this.realtimeKit.generateParticipantToken(
      channel.id,
      userId,
      displayName,
    );

    return { channelId: channel.id, authToken };
  }

  /**
   * @description
   * Request the Push-to-Talk microphone. Enforces permissions before granting.
   */
  async requestMic(
    channelId: string,
    userId: string,
    userRole: Role,
  ): Promise<void> {
    const channel = await this.repo.getChannelById(channelId);
    if (!channel || !channel.incident_id) {
      throw new NotFoundException('Channel not found');
    }

    // 1. Permission Check
    const canComm = await this.repo.canUserCommunicate(
      channel.incident_id,
      userId,
      userRole,
    );
    if (!canComm) {
      throw new ForbiddenException(
        'You must be en route or on scene to speak.',
      );
    }

    const currentSpeaker = await this.repo.getCurrentSpeaker(channelId);
    const isResponder =
      userRole === Role.RESPONDER ||
      userRole === Role.ADMIN ||
      userRole === Role.SUPER;
    const priority = isResponder ? 100 : 10;

    const queueId = await this.repo.requestMic(channelId, userId, priority);

    if (!currentSpeaker) {
      await this.repo.updateRadioStatus(queueId, CommRadioStatus.SPEAKING);
    }

    await this.emitQueueUpdate(channelId);
  }

  /**
   * @description
   * Release the Push-to-Talk microphone and grant it to the next in line.
   */
  async releaseMic(channelId: string, queueId: string): Promise<void> {
    await this.repo.updateRadioStatus(queueId, CommRadioStatus.COMPLETED);
    const queue = await this.repo.getRadioQueue(channelId);

    if (queue.length > 0) {
      const nextInLine = queue[0];
      await this.repo.updateRadioStatus(
        nextInLine.queue_id,
        CommRadioStatus.SPEAKING,
      );
    }

    await this.emitQueueUpdate(channelId);
  }

  /**
   * @description
   * Send a text message to the channel. Enforces permissions before saving.
   */
  async sendMessage(
    channelId: string,
    senderId: string,
    userRole: Role,
    content: string,
  ): Promise<CommMessage> {
    const channel = await this.repo.getChannelById(channelId);
    if (!channel || !channel.incident_id) {
      throw new NotFoundException('Channel not found');
    }

    // 1. Permission Check
    const canComm = await this.repo.canUserCommunicate(
      channel.incident_id,
      senderId,
      userRole,
    );
    if (!canComm) {
      throw new ForbiddenException('You must be en route or on scene to chat.');
    }

    const message = await this.repo.saveMessage(channelId, senderId, content);
    this.events.emit(CommsEvents.MESSAGE_NEW, { channelId, message });
    return message;
  }

  /**
   * @description
   * Get the chat history for a channel.
   */
  async getMessageHistory(
    channelId: string,
    limit?: number,
  ): Promise<CommMessage[]> {
    return this.repo.getMessageHistory(channelId, limit);
  }

  /**
   * @description
   * Internal helper to broadcast the updated Push-to-Talk queue.
   */
  private async emitQueueUpdate(channelId: string): Promise<void> {
    const queue = await this.repo.getRadioQueue(channelId);
    this.events.emit(CommsEvents.QUEUE_UPDATED, { channelId, queue });
  }
}
