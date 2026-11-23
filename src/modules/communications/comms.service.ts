import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { CommsRepository } from './comms.repository';
import { RealtimeKitService } from './realtimekit.service';
import { CommParticipantRole } from './enums/comms-participant-role.enum';
import { Role } from '../../common/enums/role-enum';
import { CommsEvents } from './comms.gateway';
import type { CommMessage } from './interfaces/comms-message.interface';
import { IncidentEvents } from '../incidents/events/incident-events';
import type { IncidentCreatedEvent } from '../incidents/events/incident-events';
import {
  ParticipantDto,
  RadioQueueItemDto,
  ActiveChannelResponseDto,
} from './dto/comms.dto';

@Injectable()
export class CommsService {
  constructor(
    private readonly repo: CommsRepository,
    private readonly realtimeKit: RealtimeKitService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(IncidentEvents.CREATED)
  async handleIncidentCreated(event: IncidentCreatedEvent): Promise<void> {
    const channelName = `Incident ${event.incidentId.substring(0, 8)} - ${event.threatType}`;

    // 1. Create in Postgres
    const channelId = await this.repo.createIncidentChannel(
      event.incidentId,
      channelName,
    );

    // 2. Create in Cloudflare
    const cfMeetingId = await this.realtimeKit.createMeeting(channelName);

    // 3. Save the CF ID to Postgres
    await this.repo.updateCfMeetingId(channelId, cfMeetingId);
  }

  async getActiveChannel(
    userId: string,
  ): Promise<ActiveChannelResponseDto | null> {
    return this.repo.findActiveChannelByUser(userId);
  }

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
      commsRole = CommParticipantRole.OBSERVER;
    }

    await this.repo.addParticipant(channel.id, userId, commsRole);

    // Use the CF meeting ID saved from the incident creation hook
    if (!channel.cf_meeting_id) {
      throw new NotFoundException('Voice channel not initialized');
    }

    const authToken = await this.realtimeKit.generateParticipantToken(
      channel.cf_meeting_id,
      userId,
      displayName,
    );

    return { channelId: channel.id, authToken };
  }

  async getParticipants(
    channelId: string,
    userId: string,
  ): Promise<ParticipantDto[]> {
    const isMember = await this.repo.isParticipant(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a participant in this channel');
    }

    const participants = await this.repo.getParticipants(channelId);

    return participants.map((p) => ({
      ...p,
      joined_at: new Date(p.joined_at).toISOString(),
    }));
  }

  async getRadioQueue(
    channelId: string,
    userId: string,
  ): Promise<RadioQueueItemDto[]> {
    const isMember = await this.repo.isParticipant(channelId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a participant in this channel');
    }

    const queue = await this.repo.getRadioQueue(channelId);
    return queue.map((q) => ({
      ...q,
      requested_at: new Date(q.requested_at).toISOString(),
    }));
  }

  async requestMic(
    channelId: string,
    userId: string,
    userRole: Role,
    mode: 'PTT' | 'OPEN_MIC',
  ): Promise<void> {
    const channel = await this.repo.getChannelById(channelId);
    if (!channel || !channel.incident_id) {
      throw new NotFoundException('Channel not found');
    }

    const incident = await this.repo.getIncidentCommsContext(
      channel.incident_id,
    );
    if (!incident) {
      throw new NotFoundException('Incident context not found');
    }

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

    const isVictim = incident.driver_id === userId;
    const isResponder =
      userRole === Role.RESPONDER ||
      userRole === Role.ADMIN ||
      userRole === Role.SUPER;

    // Safety Gate: Open Mic is strictly reserved for victims of HAZARD incidents.
    if (
      mode === 'OPEN_MIC' &&
      (!isVictim || incident.threat_category !== 'HAZARD')
    ) {
      throw new ForbiddenException(
        'Open Mic is only permitted for the victim of an active hazard.',
      );
    }

    // Priority Logic: Victim (200) > Responder (100) > Peer (10)
    let priority = 10;
    if (isVictim) {
      priority = 200;
    } else if (isResponder) {
      priority = 100;
    }

    await this.repo.requestMicAtomic(channelId, userId, priority);

    await this.emitQueueUpdate(channelId);
  }

  async releaseMic(channelId: string, queueId: string): Promise<void> {
    await this.repo.releaseMicAtomic(channelId, queueId);
    await this.emitQueueUpdate(channelId);
  }

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

  async getMessageHistory(
    channelId: string,
    limit?: number,
  ): Promise<CommMessage[]> {
    return this.repo.getMessageHistory(channelId, limit);
  }

  private async emitQueueUpdate(channelId: string): Promise<void> {
    const queue = await this.repo.getRadioQueue(channelId);
    this.events.emit(CommsEvents.QUEUE_UPDATED, { channelId, queue });
  }
}
