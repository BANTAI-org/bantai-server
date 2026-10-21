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

/** What the handshake middleware stores on every authenticated socket. */
export interface SocketUser {
  id: string;
  role: Role;
  commandCenterId: string | null;
  /** Access-token expiry, epoch seconds. The socket is closed at this time. */
  expiresAt: number | null;
}

/** The fields every incident event carries, used to pick the audience. */
interface IncidentAudience {
  incidentId: string;
  driverId: string | null;
  claimedById: string | null;
}

/** setTimeout cannot take a delay above 2^31-1 ms (about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Pushes events to connected clients. It only broadcasts: commands (claim,
 * resolve, ...) stay on REST, and the database stays the source of truth. A
 * client that misses an event recovers by refetching over REST.
 *
 * CORS: decorator arguments run when the file is imported, which can be
 * before ConfigModule has loaded .env. If WS_CORS_ORIGIN is empty here, browser
 * clients (the dashboard) are blocked; mobile apps are unaffected by CORS.
 */
@WebSocketGateway({
  namespace: 'incidents',
  cors: { origin: process.env.WS_CORS_ORIGIN?.split(',') ?? false },
})
export class IncidentGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(IncidentGateway.name);

  // With a `namespace` set, Nest injects the Namespace, not the root Server.
  @WebSocketServer()
  private server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Runs once when the gateway starts. Registers the handshake middleware, so
   * an unauthenticated socket is refused before it ever connects.
   */
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

  /** Puts a freshly connected socket in the rooms its user may listen to. */
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

    // A token is only checked at the handshake, so without this a socket
    // would stay open long after its access token expired. The client
    // reconnects with a refreshed token.
    if (user.expiresAt !== null) {
      const remainingMs = Math.max(0, user.expiresAt * 1000 - Date.now());
      const timer = setTimeout(
        () => socket.disconnect(true),
        Math.min(remainingMs, MAX_TIMER_MS),
      );
      socket.once('disconnect', () => clearTimeout(timer));
    }
  }

  // ---------------------------------------------------------------------
  // INCIDENT EVENTS
  // ---------------------------------------------------------------------

  /**
   * A new incident reaches only the rider it belongs to and supers. Nearby
   * responders and riders learn about it through the wave engine's offers, and
   * command centers only after an escalation.
   *
   * The rider's socket is also JOINED to the incident's room here, so any
   * later tracking update (which targets only Rooms.incident(id)) reaches
   * them without needing a separate socketsJoin call. Mobile clients that
   * connect late rely on the polling fallback (GET /incidents/:id/tracking).
   */
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

  /**
   * Every status change reaches everyone in the incident's room (the people
   * offered it or involved in it), plus the rider, the claimant and supers.
   * This is what makes a claimed offer disappear on other responders' screens.
   */
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

  /**
   * The command center is told, and from now on follows the incident: its
   * sockets join the incident's room so later status changes reach it too.
   */
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

  /**
   * A peer's reply goes only to the rider, the claimant and supers, not to
   * the other peers: riders should not see who else is heading there.
   */
  @OnEvent(IncidentEvents.PEER_RESPONDED)
  onPeerResponded(event: IncidentPeerRespondedEvent): void {
    const rooms = [Rooms.role('super')];
    if (event.driverId) rooms.push(Rooms.user(event.driverId));
    if (event.claimedById) rooms.push(Rooms.user(event.claimedById));
    this.emit(rooms, IncidentEvents.PEER_RESPONDED, event);
  }

  /**
   * Live responder position ("Maria Santos is on the way, ~4 min").
   *
   * Deliberately targets ONLY Rooms.incident(incidentId) — NOT the audience()
   * union. That means:
   *   * The rider receives it (joined to the incident room on CREATED).
   *   * A command center receives it after an escalation (onEscalated).
   *   * Supers do NOT receive every responder's live position, which is a
   *     deliberate privacy choice: tracking is for the people involved.
   *
   * Emitted by TrackingService on every GPS ping from an active claimant.
   * Rate is bounded by the responder's GPS ping frequency (typically 3–5 s).
   */
  @OnEvent(IncidentEvents.TRACKING_UPDATED)
  onTrackingUpdated(event: IncidentTrackingUpdatedEvent): void {
    this.emit(
      [Rooms.incident(event.incidentId)],
      IncidentEvents.TRACKING_UPDATED,
      event,
    );
  }

  // ---------------------------------------------------------------------
  // REPORT EVENTS
  // ---------------------------------------------------------------------

  /** To the reporter, their command center's admins, and supers. */
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

  // ---------------------------------------------------------------------

  private audience(event: IncidentAudience): string[] {
    const rooms = [Rooms.role('super'), Rooms.incident(event.incidentId)];
    if (event.driverId) rooms.push(Rooms.user(event.driverId));
    if (event.claimedById) rooms.push(Rooms.user(event.claimedById));
    return rooms;
  }

  /** Sends once to the union of rooms: a socket in two of them gets one copy. */
  private emit(rooms: string[], name: string, payload: unknown): void {
    this.server.to([...new Set(rooms)]).emit(name, payload);
  }

  private async authenticate(socket: Socket): Promise<SocketUser> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('missing token');

    // The secret must be passed explicitly: AuthService signs with a
    // per-call `secret`, so JwtModule has no default one. Access tokens use
    // JWT_SECRET; a refresh token (JWT_REFRESH_SECRET) fails verification here.
    const payload = await this.jwt.verifyAsync<JwtPayload & { exp?: number }>(
      token,
      { secret: this.config.getOrThrow<string>('JWT_SECRET') },
    );
    if (typeof payload.sub !== 'string' || !payload.role) {
      throw new Error('not an access token');
    }

    // NOTE: access tokens carry no session id, so a revoked session cannot be
    // detected from the token alone. The expiry cut-off in handleConnection
    // bounds how long a revoked user stays connected; to cut them off sooner,
    // call `server.in(Rooms.user(id)).disconnectSockets()` from the logout /
    // soft-delete code path.
    return {
      id: payload.sub,
      role: payload.role,
      commandCenterId: payload.command_center_id ?? null,
      expiresAt: typeof payload.exp === 'number' ? payload.exp : null,
    };
  }

  /**
   * Bearer token from the handshake: `auth: { token }` (Flutter, JS clients) or
   * an Authorization header. Cookie auth is not handled here: Fastify's cookie
   * parser does not run on a socket handshake, so a cookie-based dashboard
   * would need the cookie parsed from handshake.headers.cookie.
   */
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
