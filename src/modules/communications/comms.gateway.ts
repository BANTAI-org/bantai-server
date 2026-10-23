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

/**
 * Socket.IO event names emitted to the client for real-time updates.
 */
export const CommsEvents = {
  /** Sent when the Push-to-Talk queue changes (someone requests, speaks, or finishes). */
  QUEUE_UPDATED: 'comms.queue_updated',
  /** Sent when a new text message is posted in the channel. */
  MESSAGE_NEW: 'comms.message_new',
} as const;

/**
 * Helpers to generate standardized Socket.IO room names.
 */
const CommsRooms = {
  /** Generates the room name for a specific tactical channel. */
  channel: (id: string) => `channel:${id}`,
};

/**
 * Explicit type for the authenticated socket data.
 * Attached to `socket.data.user` during the handshake middleware.
 */
export interface SocketUser {
  id: string;
  role: string;
}

/**
 * @description
 * WebSocket Gateway for the Communications module.
 *
 * This gateway serves two primary purposes:
 * 1. **Real-Time Chat:** Broadcasts text messages to all participants in a channel.
 * 2. **Push-to-Talk State Sync:** Broadcasts the updated "Talk Queue" so all clients
 *    see exactly who is speaking and who is next in line.
 *
 * Note: Actual voice data is handled by Cloudflare RealtimeKit (WebRTC),
 * not this Socket.IO gateway.
 */
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

  /**
   * @description
   * Runs once when the gateway initializes. Registers a handshake middleware
   * that authenticates the socket using its JWT before allowing the connection.
   *
   * @param {Namespace} server - The Socket.IO namespace instance.
   */
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          // Type-safe assignment of the authenticated user to the socket
          (socket.data as { user?: SocketUser }).user = user;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
    this.logger.log('Comms Gateway initialised');
  }

  /**
   * @description
   * Handles a newly connected and authenticated socket.
   * Joins the socket to the specific channel room provided in the query parameters.
   *
   * Example connection URL from Flutter:
   * `wss://api.bantai.com/comms?channelId=123e4567-e89b-12d3-a456-426614174000`
   *
   * @param {Socket} socket - The connected socket instance.
   */
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
      // Disconnect if the client failed to specify which channel to join
      socket.disconnect(true);
    }
  }

  /**
   * @description
   * Listens for internal application events indicating the Push-to-Talk
   * queue has changed, and broadcasts the updated list to the specific channel room.
   *
   * @param {object} payload - The event payload containing the channel ID and the updated queue.
   */
  @OnEvent(CommsEvents.QUEUE_UPDATED)
  handleQueueUpdated(payload: {
    channelId: string;
    queue: CommRadioQueueView[];
  }): void {
    this.server
      .to(CommsRooms.channel(payload.channelId))
      .emit(CommsEvents.QUEUE_UPDATED, payload.queue);
  }

  /**
   * @description
   * Listens for internal application events indicating a new chat message
   * has been saved to the database, and broadcasts it to the specific channel room.
   *
   * @param {object} payload - The event payload containing the channel ID and the new message.
   */
  @OnEvent(CommsEvents.MESSAGE_NEW)
  handleNewMessage(payload: { channelId: string; message: CommMessage }): void {
    this.server
      .to(CommsRooms.channel(payload.channelId))
      .emit(CommsEvents.MESSAGE_NEW, payload.message);
  }

  /**
   * @description
   * Extracts the JWT from the socket handshake and verifies it.
   *
   * The token can be provided in two ways:
   * 1. `socket.handshake.auth.token` (Preferred for Socket.IO clients)
   * 2. `socket.handshake.headers.authorization` (Fallback: "Bearer <token>")
   *
   * @param {Socket} socket - The raw socket instance.
   * @returns {Promise<SocketUser>} The authenticated user's ID and role.
   * @throws {Error} If the token is missing, invalid, or expired.
   */
  private async authenticate(socket: Socket): Promise<SocketUser> {
    // Safe extraction of token from handshake auth object
    const auth = socket.handshake.auth as Record<string, unknown>;
    let token = typeof auth.token === 'string' ? auth.token : undefined;

    // Fallback to Authorization header if auth object doesn't have it
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
