import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CommMessage } from './interfaces/comms-message.interface';
import { CommRadioQueueView } from './interfaces/comms-radio-queue-view.interface';
import { CommsRepository } from './comms.repository';

export const CommsEvents = {
  QUEUE_UPDATED: 'comms.queue_updated',
  MESSAGE_NEW: 'comms.message_new',
} as const;

const CommsRooms = {
  channel: (id: string) => `channel:${id}`,
};

export interface SocketUser {
  id: string;
  role: string;
}

interface SocketData {
  user?: SocketUser;
  channelId?: string;
}

@WebSocketGateway({
  namespace: 'comms',
  cors: { origin: process.env.WS_CORS_ORIGIN?.split(',') ?? false },
})
export class CommsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(CommsGateway.name);

  @WebSocketServer()
  private server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly commsRepository: CommsRepository,
  ) {}

  afterInit(server: Namespace): void {
    // Pass the async logic to a separate method and mark it void
    // to satisfy the linter's synchronous middleware expectation.
    server.use((socket, next) => {
      void this.handleHandshake(socket, next);
    });
    this.logger.log('Comms Gateway initialised');
  }

  handleConnection(socket: Socket): void {
    const data = socket.data as SocketData;
    const user = data.user;
    const channelId = data.channelId;

    // Middleware guarantees these exist, but we check for safety
    if (!user || !channelId) {
      socket.disconnect(true);
      return;
    }

    void socket.join(CommsRooms.channel(channelId));
    this.logger.log(`User ${user.id} joined comms channel: ${channelId}`);
  }

  @OnEvent(CommsEvents.QUEUE_UPDATED)
  handleQueueUpdated(payload: {
    channelId: string;
    queue: CommRadioQueueView[];
  }): void {
    this.server
      .to(CommsRooms.channel(payload.channelId))
      .emit(CommsEvents.QUEUE_UPDATED, payload.queue);
  }

  @OnEvent(CommsEvents.MESSAGE_NEW)
  handleNewMessage(payload: { channelId: string; message: CommMessage }): void {
    this.server
      .to(CommsRooms.channel(payload.channelId))
      .emit(CommsEvents.MESSAGE_NEW, payload.message);
  }

  private async handleHandshake(
    socket: Socket,
    next: (err?: Error) => void,
  ): Promise<void> {
    try {
      // 1. Authenticate the JWT
      const user = await this.authenticate(socket);

      // 2. Validate the channelId query parameter
      const channelId = socket.handshake.query.channelId;
      if (typeof channelId !== 'string' || !channelId) {
        throw new Error('channelId query parameter is required');
      }

      // 3. Verify the user is actually a participant in this channel
      const isParticipant = await this.commsRepository.isParticipant(
        channelId,
        user.id,
      );
      if (!isParticipant) {
        throw new Error('User is not a registered participant');
      }

      // 4. Attach validated data to the socket
      (socket.data as SocketData).user = user;
      (socket.data as SocketData).channelId = channelId;

      next();
    } catch (error) {
      this.logger.warn(
        `Socket connection rejected: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      next(new Error('unauthorized'));
    }
  }

  private async authenticate(socket: Socket): Promise<SocketUser> {
    const auth = socket.handshake.auth as Record<string, unknown>;
    let token = typeof auth.token === 'string' ? auth.token : undefined;

    if (!token && socket.handshake.headers.authorization) {
      const parts = socket.handshake.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
      }
    }

    if (!token) throw new Error('missing token');

    const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
    });

    return { id: payload.sub, role: payload.role };
  }
}
