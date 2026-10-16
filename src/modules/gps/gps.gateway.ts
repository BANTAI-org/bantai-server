import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Namespace, Socket } from 'socket.io';
import { REDIS_CLIENT } from '../redis/provider/redis.provider';
import { Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Role } from '../../common/enums/role-enum';

interface SocketUser {
  id: string;
  role: Role;
}

interface DutyUpdatePayload {
  userId: string;
  role: Role;
  status: string;
}

function isDutyUpdatePayload(payload: unknown): payload is DutyUpdatePayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const data = payload as Record<string, unknown>;
  return (
    typeof data.userId === 'string' &&
    Object.values(Role).includes(data.role as Role) &&
    typeof data.status === 'string'
  );
}

/**
 * GPS WebSocket gateway for live location tracking.
 * Clients connect to receive real-time location updates for themselves or others
 * based on duty status and subscriptions.
 */
@WebSocketGateway({
  namespace: 'gps',
  cors: { origin: process.env.WS_CORS_ORIGIN?.split(',') ?? [] },
})
@Injectable()
export class GpsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(GpsGateway.name);

  @WebSocketServer()
  private server!: Namespace;

  // Map of userId to set of sockets for that user
  private userSockets = new Map<string, Set<Socket>>();
  // Map of userId to subscription callback for GPS updates channel
  private gpsSubscriptions = new Map<
    string,
    (channel: string, message: string) => void
  >();
  // Map of userId to subscription callback for duty updates channel (shared)
  private dutySubscriptionCallback!: (channel: string, message: string) => void;
  private readonly subscriber: Redis;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel === 'duty:updates') {
        this.dutySubscriptionCallback?.(channel, message);
        return;
      }

      const userId = channel.slice('gps:updates:'.length);
      this.gpsSubscriptions.get(userId)?.(channel, message);
    });
  }

  /**
   * Initialize the gateway: set up handshake authentication and subscribe to duty updates.
   */
  async afterInit(server: Namespace): Promise<void> {
    // Authentication middleware: verify JWT from handshake auth
    server.use((socket: Socket, next: (err?: Error) => void) => {
      this.authenticateSocket(socket)
        .then((user) => {
          (socket.data as { user?: SocketUser }).user = user;
          next();
        })
        .catch((err: Error | undefined) =>
          next(err ?? new Error('Unauthorized')),
        );
    });

    // Subscribe to duty updates channel to listen for duty status changes
    this.dutySubscriptionCallback = (channel: string, message: string) => {
      try {
        const payload: unknown = JSON.parse(message);
        if (!isDutyUpdatePayload(payload)) {
          throw new Error('Invalid duty update payload');
        }
        const { userId, role, status } = payload;
        this.handleDutyUpdate(userId, role, status);
      } catch (err: unknown) {
        this.logger.error(`Failed to parse duty update: ${String(err)}`);
      }
    };
    await this.subscriber.subscribe('duty:updates');

    this.logger.log('GPS gateway initialized');
  }

  /**
   * Handle new socket connection: authenticate and store socket by userId.
   */
  handleConnection(socket: Socket): void {
    const user = (socket.data as { user?: SocketUser }).user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const { id: userId, role: role } = user;
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket);

    this.logger.log(
      `Client connected: userId=${userId}, role=${role}, sockets=${this.userSockets.get(userId)!.size}`,
    );
  }

  /**
   * Handle socket disconnection: clean up subscriptions and remove socket.
   */
  handleDisconnect(socket: Socket): void {
    const user = (socket.data as { user?: SocketUser }).user;
    if (!user) {
      return;
    }

    const { id: userId } = user;
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
        // Stop GPS updates for this user if no sockets remain
        this.stopGpsUpdatesForUser(userId);
      }
    }

    this.logger.log(
      `Client disconnected: userId=${userId}, remaining sockets=${this.userSockets.get(userId)?.size ?? 0}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }

  /**
   * Authenticate socket via JWT from handshake auth or headers.
   */
  private async authenticateSocket(
    socket: Socket,
  ): Promise<{ id: string; role: Role }> {
    const token =
      (socket.handshake.auth as { token?: string })?.token ||
      socket.handshake.headers.authorization?.split(' ')[1];

    if (!token) {
      throw new Error('No token provided');
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: Role }>(
        token,
        { secret: this.config.getOrThrow<string>('JWT_SECRET') },
      );
      return {
        id: payload.sub,
        role: payload.role,
      };
    } catch {
      throw new Error('Invalid token');
    }
  }

  /**
   * Start sending GPS updates for a user: subscribe to their GPS updates channel.
   */
  private startGpsUpdatesForUser(userId: string, role: Role): void {
    // Avoid duplicate subscriptions
    if (this.gpsSubscriptions.has(userId)) {
      return;
    }

    const callback = (channel: string, message: string) => {
      try {
        const data: unknown = JSON.parse(message);
        // Broadcast to all sockets for this user
        const sockets = this.userSockets.get(userId);
        if (sockets) {
          sockets.forEach((socket) => {
            if (socket.connected) {
              socket.emit('gps-update', data);
            }
          });
        }
      } catch (err: unknown) {
        this.logger.error(
          `Failed to process GPS updates for ${userId}: ${String(err)}`,
        );
      }
    };

    this.gpsSubscriptions.set(userId, callback);
    void this.subscriber
      .subscribe(`gps:updates:${userId}`)
      .catch((err: Error) =>
        this.logger.error(
          `Failed to subscribe to GPS updates for ${userId}: ${err.message}`,
        ),
      );
    this.logger.log(`Started GPS updates for user ${userId} (role ${role})`);
  }

  /**
   * Stop sending GPS updates for a user: unsubscribe from their GPS updates channel.
   */
  private stopGpsUpdatesForUser(userId: string): void {
    const callback = this.gpsSubscriptions.get(userId);
    if (!callback) {
      return;
    }
    void this.subscriber
      .unsubscribe(`gps:updates:${userId}`)
      .catch((err: Error) =>
        this.logger.error(
          `Failed to unsubscribe from GPS updates for ${userId}: ${err.message}`,
        ),
      );
    this.gpsSubscriptions.delete(userId);
    this.logger.log(`Stopped GPS updates for user ${userId}`);
  }

  /**
   * Handle duty update messages from the duty:updates channel.
   * When a user goes on/off duty, start/stop GPS updates for their connected sockets.
   */
  private handleDutyUpdate(userId: string, role: Role, status: string): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) {
      // No connected clients for this user; nothing to do
      return;
    }

    if (status === 'on duty') {
      this.startGpsUpdatesForUser(userId, role);
    } else if (status === 'off duty') {
      this.stopGpsUpdatesForUser(userId);
    }
  }
}
