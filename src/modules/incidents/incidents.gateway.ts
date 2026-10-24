import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { Role } from '../../common/enums/role-enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  type IncidentCreatedEvent,
  type IncidentEscalatedEvent,
  IncidentEvents,
  type IncidentPeerRespondedEvent,
  type IncidentStatusChangedEvent,
  type IncidentThreatLevelChangedEvent,
  type IncidentTrackingUpdatedEvent,
  type IncidentVerifiedEvent,
  ReportEvents,
  type ReportStatusChangedEvent,
  Rooms,
} from './events/incident-events';
import type { NearbyUser } from '../redis/redis.service';

export interface SocketUser {
  id: string;
  role: Role;
  commandCenterId: string | null;
  expiresAt: number | null;
}

interface IncidentAudience {
  incidentId: string;
  driverId: string | null;
  claimedById: string | null;
}

const MAX_TIMER_MS = 2_147_483_647;

@WebSocketGateway({
  namespace: 'incidents',
  cors: { origin: process.env.WS_CORS_ORIGIN?.split(',') ?? false },
})
export class IncidentGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(IncidentGateway.name);

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
    this.logger.log('Incident gateway initialised');
  }

  handleConnection(socket: Socket): void {
    const user = (socket.data as { user?: SocketUser }).user;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    const rooms = [Rooms.user(user.id), Rooms.role(user.role)];
    if (user.commandCenterId)
      rooms.push(Rooms.commandCenter(user.commandCenterId));
    void socket.join(rooms);

    if (user.expiresAt !== null) {
      const remainingMs = Math.max(0, user.expiresAt * 1000 - Date.now());
      const timer = setTimeout(
        () => socket.disconnect(true),
        Math.min(remainingMs, MAX_TIMER_MS),
      );
      socket.once('disconnect', () => clearTimeout(timer));
    }
  }

  @OnEvent(IncidentEvents.CREATED)
  onIncidentCreated(event: IncidentCreatedEvent): void {
    const rooms = [Rooms.role('super')];
    if (event.driverId) rooms.push(Rooms.user(event.driverId));
    this.emit(rooms, IncidentEvents.CREATED, event);

    if (event.driverId) {
      void this.server
        .in(Rooms.user(event.driverId))
        .socketsJoin(Rooms.incident(event.incidentId));
    }
  }

  @OnEvent(IncidentEvents.STATUS_CHANGED)
  onStatusChanged(event: IncidentStatusChangedEvent): void {
    this.emit(this.audience(event), IncidentEvents.STATUS_CHANGED, event);
  }

  @OnEvent(IncidentEvents.THREAT_LEVEL_CHANGED)
  onThreatLevelChanged(event: IncidentThreatLevelChangedEvent): void {
    this.emit(this.audience(event), IncidentEvents.THREAT_LEVEL_CHANGED, event);
  }

  @OnEvent(IncidentEvents.VERIFIED)
  onVerified(event: IncidentVerifiedEvent): void {
    this.emit(this.audience(event), IncidentEvents.VERIFIED, event);
  }

  @OnEvent(IncidentEvents.ESCALATED)
  onEscalated(event: IncidentEscalatedEvent): void {
    const center = Rooms.commandCenter(event.commandCenterId);
    this.server.in(center).socketsJoin(Rooms.incident(event.incidentId));
    this.emit(
      [...this.audience(event), center],
      IncidentEvents.ESCALATED,
      event,
    );
  }

  @OnEvent(IncidentEvents.PEER_RESPONDED)
  onPeerResponded(event: IncidentPeerRespondedEvent): void {
    const rooms = [Rooms.role('super')];
    if (event.driverId) rooms.push(Rooms.user(event.driverId));
    if (event.claimedById) rooms.push(Rooms.user(event.claimedById));
    this.emit(rooms, IncidentEvents.PEER_RESPONDED, event);
  }

  @OnEvent(IncidentEvents.TRACKING_UPDATED)
  onTrackingUpdated(event: IncidentTrackingUpdatedEvent): void {
    this.emit(
      [Rooms.incident(event.incidentId)],
      IncidentEvents.TRACKING_UPDATED,
      event,
    );
  }

  @OnEvent('peer.notified')
  onPeerNotified(event: {
    incidentId: string;
    nearbyDrivers: NearbyUser[];
  }): void {
    for (const driver of event.nearbyDrivers) {
      this.emit([Rooms.user(driver.user_id)], 'incident.peer_nearby', {
        incidentId: event.incidentId,
        distanceMeters: driver.distance_meters,
      });
    }
  }

  // ---------------------------------------------------------------------
  // WAVE DISPATCH EVENTS
  // ---------------------------------------------------------------------

  @OnEvent('wave.issued')
  onWaveIssued(event: {
    incidentId: string;
    waveId: string;
    waveNumber: number;
    responders: { user_id: string; distance_meters: number }[];
  }): void {
    for (const responder of event.responders) {
      this.emit([Rooms.user(responder.user_id)], 'incident.wave_offer', {
        incidentId: event.incidentId,
        waveId: event.waveId,
        waveNumber: event.waveNumber,
        distanceMeters: responder.distance_meters,
        message: `Emergency nearby (${Math.round(responder.distance_meters)}m). Tap to view.`,
      });
    }
  }

  // ---------------------------------------------------------------------
  // REPORT EVENTS
  // ---------------------------------------------------------------------

  @OnEvent(ReportEvents.STATUS_CHANGED)
  onReportStatusChanged(event: ReportStatusChangedEvent): void {
    const rooms = [
      Rooms.role('super'),
      Rooms.commandCenter(event.commandCenterId),
    ];
    if (event.assignedReporterId)
      rooms.push(Rooms.user(event.assignedReporterId));
    this.emit(rooms, ReportEvents.STATUS_CHANGED, event);
  }

  private audience(event: IncidentAudience): string[] {
    const rooms = [Rooms.role('super'), Rooms.incident(event.incidentId)];
    if (event.driverId) rooms.push(Rooms.user(event.driverId));
    if (event.claimedById) rooms.push(Rooms.user(event.claimedById));
    return rooms;
  }

  private emit(rooms: string[], name: string, payload: unknown): void {
    this.server.to([...new Set(rooms)]).emit(name, payload);
  }

  private async authenticate(socket: Socket): Promise<SocketUser> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('missing token');

    const payload = await this.jwt.verifyAsync<JwtPayload & { exp?: number }>(
      token,
      { secret: this.config.getOrThrow<string>('JWT_SECRET') },
    );
    if (typeof payload.sub !== 'string' || !payload.role) {
      throw new Error('not an access token');
    }

    return {
      id: payload.sub,
      role: payload.role,
      commandCenterId: payload.command_center_id ?? null,
      expiresAt: typeof payload.exp === 'number' ? payload.exp : null,
    };
  }

  private extractToken(socket: Socket): string | null {
    const fromAuth = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof fromAuth === 'string' && fromAuth !== '') return fromAuth;

    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return null;
  }
}
