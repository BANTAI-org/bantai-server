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
  ) {}

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          (socket.data as { user?: SocketUser }).user = user;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
    this.logger.log('Comms Gateway initialised');
  }

  handleConnection(socket: Socket): void {
    const user = (socket.data as { user?: SocketUser }).user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const channelId = socket.handshake.query.channelId;
    if (typeof channelId === 'string') {
      void socket.join(CommsRooms.channel(channelId));
      this.logger.log(`User ${user.id} joined comms channel: ${channelId}`);
    } else {
      socket.disconnect(true);
    }
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
