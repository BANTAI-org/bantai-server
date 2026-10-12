import { DatabaseService } from '../../database/database.service';
import { CreateIncidentData } from './types/datas/incident-datas/create-incident-data.types';
import { IncidentLogEntity } from './interfaces/incident-log-entity.interface';
import { IncidentEntity } from './interfaces/incident-entity.interface';
import { PeerResponseStatus } from './enums/peer-response-status.enum';
import { ArrivalConfirmationMethod } from './enums/arrival-confirmation-method.enum';
import { IncidentStatus } from './enums/incident-status.enum';
import { IncidentOutcome } from './enums/incident-outcome.enum';
import { ThreatLevel } from './enums/threat-level.enum';
import { EscalationReason } from './enums/escalation-reason.enum';
import { toIncidentLog } from './utils/incident-log-confidence.util';
import {
  ResolveResult,
  VerifyResult,
} from './types/incident-action-result.types';
import { UpdateSeverityOutcome } from './dto/incident-action-result.types';
import { IncidentSeverity } from './enums/incident-severity.enum';
import {
  CURSOR_COLUMN,
  CursorPage,
  PageOptions,
  clampLimit,
  cursorTsSql,
  keysetPredicate,
  queryRows,
  stripCursorColumn,
  toPage,
} from '../../common/utils/cursor-pagination-helper.util';
import { Injectable } from '@nestjs/common';

/**
 * Policy assumption (change here if it differs): these roles may verify an
 * incident; riders (peers) never may. Used as `u.role IN (...)`.
 */
const VERIFIER_ROLES = `('responder', 'admin', 'super')`;

/**
 * SQL twin of isPeerHelpEligible() (peer-help-policy.util): may a nearby rider
 * physically help? `alias` is a row with threat_type, threat_category, severity
 * and threat_level. Keep the two in step; a test compares them over every
 * combination.
 */
export const peerEligibleSql = (alias: string): string => `(
    ${alias}.threat_category = 'ASSIST'
    AND ${alias}.threat_type NOT IN ('GUN', 'BLADE')
    AND ${alias}.severity = 'MINOR'
    AND ${alias}.threat_level = 'CLEAR'
  )`;

/**
 * Stands down peers who are en route / on scene of an incident that has just
 * stopped being peer-eligible. Runs as a data-modifying CTE in the SAME
 * statement as the change, so the incident can never be ineligible while a
 * peer is still heading there. Expects a CTE named `changed` with the incident
 * columns peerEligibleSql reads.
 */
const STAND_DOWN_INELIGIBLE_PEERS = `
       revoked AS (
         UPDATE incident_peer_response p
            SET status = 'stood_down',
                responded_at = COALESCE(p.responded_at, now())
           FROM changed c
          WHERE p.incident_id = c.id
            AND p.status IN ('en_route', 'on_scene')
            AND NOT ${peerEligibleSql('c')}
          RETURNING p.peer_driver_id
       )`;

/** The incident's own columns, with the geography and NUMERIC made readable. */
const INCIDENT_COLUMNS = `
  i.id, i.driver_id, i.device_id,
  ST_X(i.location::geometry) AS lng, ST_Y(i.location::geometry) AS lat,
  i.trigger_source, i.confidence_level::float8 AS confidence_level, i.evidence,
  i.threat_category, i.threat_level, i.threat_type, i.severity,
  i.status, i.outcome,
  i.claimed_by_id, i.claimed_at, i.dispatched_at, i.on_scene_at,
  i.escalated_at, i.resolved_at, i.cancelled_at, i.resolved_by_id,
  i.verified_by_id, i.verified_at, i.verification_notes,
  i.created_at, i.updated_at`;

type IncidentRow = Omit<IncidentEntity, 'location'> & {
  lng: number;
  lat: number;
};

interface IncidentRowWithCursor extends IncidentRow {
  cursor_t: string;
}

interface IncidentLogRow extends Record<string, unknown> {
  incident_id: string;
  cursor_t: string;
}

function toIncident(row: IncidentRow): IncidentEntity {
  const { lng, lat, ...rest } = row;
  return { ...rest, location: { longitude: lng, latitude: lat } };
}
@Injectable()
export class IncidentRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Inserts the incident and returns its id. threat_level is decided here: an
   * ASSIST incident (no adversary) starts CLEAR, anything else ACTIVE_THREAT,
   * which is what the peer-help policy and the wave engine expect.
   */
  async createIncident(data: CreateIncidentData): Promise<string | null> {
    const {
      driver_id,
      device_id,
      location,
      trigger_source,
      confidence_level,
      evidence,
      threat_type,
      threat_category,
      severity,
    } = data;

    const sql = `
      INSERT INTO incident (
        driver_id, device_id, location, trigger_source,
        confidence_level, evidence, threat_type, threat_category, severity,
        threat_level
      )
      VALUES (
        $1, $2,
        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
        $5, $6, $7::jsonb, $8, $9,
        COALESCE($10::incident_severity_enum, 'UNKNOWN'),
        CASE WHEN $9::threat_category_enum = 'ASSIST'
             THEN 'CLEAR'::threat_level_enum
             ELSE 'ACTIVE_THREAT'::threat_level_enum END
      )
      RETURNING id`;

    const rows = await queryRows<{ id: string }>(this.db, sql, [
      driver_id,
      device_id,
      location.longitude,
      location.latitude,
      trigger_source,
      confidence_level ?? null,
      JSON.stringify(evidence ?? []),
      threat_type,
      threat_category,
      severity ?? null,
    ]);

    return rows[0]?.id ?? null;
  }

  // ---------------------------------------------------------------------
  // RESPONDER PROGRESS: these go through incident_responder_assignment.
  // Triggers move the incident (CLAIMED / EN_ROUTE / ON_SCENE / back to
  // DISPATCHING) and void the other offers. Patching incident.status
  // directly leaves the assignment rows out of sync.
  //
  // The sync trigger silently skips the incident update when the incident is
  // not in the expected state (e.g. already ESCALATED), which would leave the
  // assignment ahead of the incident. So markEnRoute / markArrived also require
  // the incident to be in the matching state, held by this responder.
  // ---------------------------------------------------------------------

  /**
   * A responder claims an offered incident. Resolves true if they won,
   * false if they lost the race or the offer is no longer open. Throws
   * (check_violation) if the incident is already closed or cancelled.
   */
  async claimIncident(
    incidentId: string,
    responderId: string,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident_responder_assignment
          SET status = 'CLAIMED'
        WHERE incident_id = $1
          AND responder_id = $2
          AND status = 'OFFERED'`,
      [incidentId, responderId],
    );
    return result.rowCount === 1;
  }

  /** The claimant heads to the scene (CLAIMED -> EN_ROUTE). */
  async markEnRoute(incidentId: string, responderId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident_responder_assignment a
          SET status = 'EN_ROUTE'
        WHERE a.incident_id = $1::uuid
          AND a.responder_id = $2::uuid
          AND a.status = 'CLAIMED'
          AND EXISTS (SELECT 1 FROM incident i
                       WHERE i.id = a.incident_id
                         AND i.status = 'CLAIMED'
                         AND i.claimed_by_id = a.responder_id)`,
      [incidentId, responderId],
    );
    return result.rowCount === 1;
  }

  /**
   * The claimant is on scene (CLAIMED / EN_ROUTE -> ARRIVED, which moves the
   * incident to ON_SCENE). The schema requires arrived_at AND the method
   * together. `confirmedById` is who confirmed it, for manual confirmation.
   */
  async markArrived(
    incidentId: string,
    responderId: string,
    method: ArrivalConfirmationMethod,
    confirmedById?: string | null,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident_responder_assignment a
          SET status = 'ARRIVED',
              arrived_at = now(),
              arrival_confirmation_method = $3::arrival_confirmation_method,
              arrived_confirmed_by = $4::uuid
        WHERE a.incident_id = $1::uuid
          AND a.responder_id = $2::uuid
          AND a.status IN ('CLAIMED', 'EN_ROUTE')
          AND EXISTS (SELECT 1 FROM incident i
                       WHERE i.id = a.incident_id
                         AND i.status IN ('CLAIMED', 'EN_ROUTE')
                         AND i.claimed_by_id = a.responder_id)`,
      [incidentId, responderId, method, confirmedById ?? null],
    );
    return result.rowCount === 1;
  }

  /**
   * The claimant walks away before reaching the scene. The incident goes back
   * to DISPATCHING for another wave. Not possible once ARRIVED.
   */
  async standDown(incidentId: string, responderId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident_responder_assignment
          SET status = 'STOOD_DOWN'
        WHERE incident_id = $1::uuid
          AND responder_id = $2::uuid
          AND status IN ('CLAIMED', 'EN_ROUTE')`,
      [incidentId, responderId],
    );
    return result.rowCount === 1;
  }

  // ---------------------------------------------------------------------
  // PEERS: a separate table. Never changes the incident.
  // ---------------------------------------------------------------------

  /**
   * A nearby rider responds to an incident they were notified about.
   * Resolves false if this rider was never notified (no row to update).
   * The database does not stamp responded_at for peers, so it is set here.
   */
  async recordPeerResponse(
    incidentId: string,
    peerDriverId: string,
    status: PeerResponseStatus,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident_peer_response
          SET status = $3,
              responded_at = COALESCE(responded_at, now())
        WHERE incident_id = $1
          AND peer_driver_id = $2`,
      [incidentId, peerDriverId, status],
    );
    return result.rowCount === 1;
  }

  // ---------------------------------------------------------------------
  // INCIDENT-LEVEL TRANSITIONS: updates on incident, each with its own
  // preconditions and a status guard, so a stale caller cannot make a "valid"
  // move on an incident that has moved on.
  //
  // Audit actor: some audit rows read the actor from the session setting
  // app.current_user_id. Where that matters (cancel, threat level) the
  // statement sets it itself, scoped to that statement, so no separate
  // transaction is needed. Multi-table actions (cancel, escalate) are ONE
  // statement, so they are atomic without a transaction.
  // ---------------------------------------------------------------------

  /** The claimant asks for independent verification (ON_SCENE -> AWAITING_VERIFICATION). */
  async requestVerification(
    incidentId: string,
    responderId: string,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE incident
          SET status = 'AWAITING_VERIFICATION'
        WHERE id = $1::uuid
          AND status = 'ON_SCENE'
          AND claimed_by_id = $2::uuid`,
      [incidentId, responderId],
    );
    return result.rowCount === 1;
  }

  /**
   * A second person independently verifies the scene outcome (four-eyes).
   * The verifier must be a responder, admin or super, and can never be the
   * claimant (also a DB constraint). Does not resolve the incident: call
   * resolveIncident afterwards.
   */
  async verifyIncident(
    incidentId: string,
    verifierId: string,
    notes?: string | null,
  ): Promise<VerifyResult> {
    const result = await this.db.query(
      `UPDATE incident i
          SET verified_by_id = $2::uuid,
              verified_at = now(),
              verification_notes = $3::text
        WHERE i.id = $1::uuid
          AND i.status = 'AWAITING_VERIFICATION'
          AND i.verified_at IS NULL
          AND i.claimed_by_id IS DISTINCT FROM $2::uuid
          AND EXISTS (SELECT 1 FROM user_account u
                       WHERE u.id = $2::uuid
                         AND u.deleted_at IS NULL
                         AND u.role IN ${VERIFIER_ROLES})`,
      [incidentId, verifierId, notes ?? null],
    );
    if (result.rowCount === 1) return 'verified';

    const [row] = await queryRows<{
      claimed_by_id: string | null;
      verifier_role: string | null;
    }>(
      this.db,
      `SELECT i.claimed_by_id, u.role AS verifier_role
         FROM incident i
         LEFT JOIN user_account u ON u.id = $2::uuid AND u.deleted_at IS NULL
        WHERE i.id = $1::uuid`,
      [incidentId, verifierId],
    );
    if (!row) return 'not_found';
    if (
      row.verifier_role === null ||
      !['responder', 'admin', 'super'].includes(row.verifier_role)
    ) {
      return 'forbidden';
    }
    if (row.claimed_by_id === verifierId) return 'own_claim';
    return 'not_verifiable';
  }

  /**
   * Closes an incident with an outcome. Allowed from ON_SCENE,
   * AWAITING_VERIFICATION or ESCALATED, by the claimant or an admin/super.
   * Safety gate (also a DB constraint): ASSIST, or DE_ESCALATABLE once the
   * scene is DE_ESCALATED/CLEAR, may close directly; everything else needs
   * verifyIncident first.
   *
   * Assignments are deliberately left as they are: the DB notifies the
   * responders who were CLAIMED/EN_ROUTE/ARRIVED when it resolves, so queries
   * for "a responder's current incident" must also check the incident is not
   * RESOLVED/CANCELLED.
   */
  async resolveIncident(
    incidentId: string,
    outcome: IncidentOutcome,
    resolvedById: string,
  ): Promise<ResolveResult> {
    const result = await this.db.query(
      `UPDATE incident i
          SET status = 'RESOLVED',
              outcome = $2::outcome_enum,
              resolved_by_id = $3::uuid
        WHERE i.id = $1::uuid
          AND i.status IN ('ON_SCENE', 'AWAITING_VERIFICATION', 'ESCALATED')
          AND $2::outcome_enum <> 'unresolved'
          AND (i.threat_category = 'ASSIST'
               OR (i.threat_category = 'DE_ESCALATABLE'
                   AND i.threat_level IN ('DE_ESCALATED', 'CLEAR'))
               OR i.verified_at IS NOT NULL)
          AND (i.claimed_by_id = $3::uuid
               OR EXISTS (SELECT 1 FROM user_account u
                           WHERE u.id = $3::uuid
                             AND u.deleted_at IS NULL
                             AND u.role IN ('admin', 'super')))`,
      [incidentId, outcome, resolvedById],
    );
    if (result.rowCount === 1) return 'resolved';

    const [row] = await queryRows<{
      status: string;
      claimed_by_id: string | null;
      threat_category: string;
      threat_level: string;
      verified_at: Date | null;
      resolver_role: string | null;
    }>(
      this.db,
      `SELECT i.status, i.claimed_by_id, i.threat_category, i.threat_level,
              i.verified_at, u.role AS resolver_role
         FROM incident i
         LEFT JOIN user_account u ON u.id = $2::uuid AND u.deleted_at IS NULL
        WHERE i.id = $1::uuid`,
      [incidentId, resolvedById],
    );
    if (!row) return 'not_found';
    const mayResolve =
      row.claimed_by_id === resolvedById ||
      row.resolver_role === 'admin' ||
      row.resolver_role === 'super';
    if (!mayResolve) return 'forbidden';
    if (
      !['ON_SCENE', 'AWAITING_VERIFICATION', 'ESCALATED'].includes(row.status)
    ) {
      return 'not_resolvable';
    }
    if ((outcome as string) === 'unresolved') return 'invalid_outcome';
    return 'needs_verification';
  }

  /**
   * Changes how dangerous the scene is. Returns null if the incident is
   * closed, missing, or already at that level; otherwise the ids of any peers
   * who were en route / on scene and were stood down because the incident is
   * no longer peer-eligible (an empty array when none). The stand-down happens
   * in the SAME statement as the change. `updatedById` is who made the change,
   * for the audit row (it falls back to the claimant when omitted).
   */
  async updateThreatLevel(
    incidentId: string,
    level: ThreatLevel,
    updatedById?: string | null,
  ): Promise<string[] | null> {
    const [row] = await queryRows<{ changed: number; revoked: string[] }>(
      this.db,
      `WITH actor AS (
         SELECT set_config('app.current_user_id', COALESCE($3::text, ''), true)
       ),
       changed AS (
         UPDATE incident i
            SET threat_level = $2::threat_level_enum
           FROM actor
          WHERE i.id = $1::uuid
            AND i.status NOT IN ('RESOLVED', 'CANCELLED')
            AND i.threat_level IS DISTINCT FROM $2::threat_level_enum
          RETURNING i.id, i.threat_type, i.threat_category, i.severity,
                    i.threat_level
       ),${STAND_DOWN_INELIGIBLE_PEERS}
       SELECT (SELECT count(*) FROM changed)::int AS changed,
              COALESCE((SELECT array_agg(peer_driver_id) FROM revoked),
                       '{}') AS revoked`,
      [incidentId, level, updatedById ?? null],
    );
    return row && row.changed > 0 ? row.revoked : null;
  }

  /**
   * Assesses how hurt / how urgent it is (the rider's self-report at creation
   * can be corrected here). Allowed for the claimant, an admin or a super. If
   * the new severity makes the incident peer-ineligible (anything but MINOR),
   * peers who were en route / on scene are stood down in the same statement
   * and returned so they can be told. Severity changes are not audited by the
   * database.
   */
  async updateSeverity(
    incidentId: string,
    severity: IncidentSeverity,
    updatedById: string,
  ): Promise<UpdateSeverityOutcome> {
    const [row] = await queryRows<{ changed: number; revoked: string[] }>(
      this.db,
      `WITH changed AS (
         UPDATE incident i
            SET severity = $2::incident_severity_enum
          WHERE i.id = $1::uuid
            AND i.status NOT IN ('RESOLVED', 'CANCELLED')
            AND i.severity IS DISTINCT FROM $2::incident_severity_enum
            AND (i.claimed_by_id = $3::uuid
                 OR EXISTS (SELECT 1 FROM user_account u
                             WHERE u.id = $3::uuid
                               AND u.deleted_at IS NULL
                               AND u.role IN ('admin', 'super')))
          RETURNING i.id, i.threat_type, i.threat_category, i.severity,
                    i.threat_level
       ),${STAND_DOWN_INELIGIBLE_PEERS}
       SELECT (SELECT count(*) FROM changed)::int AS changed,
              COALESCE((SELECT array_agg(peer_driver_id) FROM revoked),
                       '{}') AS revoked`,
      [incidentId, severity, updatedById],
    );
    if (row && row.changed > 0) {
      return { result: 'updated', standDownPeerIds: row.revoked };
    }

    // Nothing changed: say why (read-only, only picks the message).
    const [info] = await queryRows<{
      status: string;
      severity: string;
      claimed_by_id: string | null;
      updater_role: string | null;
    }>(
      this.db,
      `SELECT i.status, i.severity, i.claimed_by_id, u.role AS updater_role
         FROM incident i
         LEFT JOIN user_account u ON u.id = $2::uuid AND u.deleted_at IS NULL
        WHERE i.id = $1::uuid`,
      [incidentId, updatedById],
    );
    const none: string[] = [];
    if (!info) return { result: 'not_found', standDownPeerIds: none };
    const mayUpdate =
      info.claimed_by_id === updatedById ||
      info.updater_role === 'admin' ||
      info.updater_role === 'super';
    if (!mayUpdate) return { result: 'forbidden', standDownPeerIds: none };
    if (info.status === 'RESOLVED' || info.status === 'CANCELLED') {
      return { result: 'closed', standDownPeerIds: none };
    }
    return { result: 'unchanged', standDownPeerIds: none };
  }

  /**
   * Hands the incident to a command center: ONE statement that moves the
   * incident to ESCALATED and records the escalation row, so a bare status
   * change can never escalate to nobody. Returns the escalation id, or null if
   * the incident is missing, closed, or already ESCALATED. Throws (23503) for
   * an unknown command center, in which case nothing changes.
   * Re-escalating to a different center means releasing the incident back to
   * DISPATCHING first (the DB closes the old escalation when it leaves ESCALATED).
   * `escalatedById` null means the system (the SLA sweeper).
   */
  async escalateIncident(
    incidentId: string,
    commandCenterId: string,
    reason: EscalationReason,
    escalatedById?: string | null,
    notes?: string | null,
  ): Promise<string | null> {
    const rows = await queryRows<{ id: string }>(
      this.db,
      `WITH moved AS (
         UPDATE incident
            SET status = 'ESCALATED'
          WHERE id = $1::uuid
            AND status NOT IN ('ESCALATED', 'RESOLVED', 'CANCELLED')
          RETURNING id
       )
       INSERT INTO incident_escalation
         (incident_id, command_center_id, reason, escalated_by_id, notes)
       SELECT moved.id, $2::uuid, $3::escalation_reason_enum, $4::uuid, $5::text
         FROM moved
       RETURNING id`,
      [
        incidentId,
        commandCenterId,
        reason,
        escalatedById ?? null,
        notes ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Cancels an incident (terminal) and, in the same statement, stands down
   * every active responder (CLAIMED / EN_ROUTE / ARRIVED) so nobody keeps
   * counting as "on" a cancelled incident. The DB itself only expires the
   * OFFERED rows. Returns false if the incident is missing or already closed.
   * `cancelledById` is recorded as the audit actor.
   */
  async cancelIncident(
    incidentId: string,
    cancelledById?: string | null,
  ): Promise<boolean> {
    const rows = await queryRows<{ cancelled: number }>(
      this.db,
      `WITH actor AS (
         SELECT set_config('app.current_user_id', COALESCE($2::text, ''), true)
       ),
       cancelled AS (
         UPDATE incident i
            SET status = 'CANCELLED'
           FROM actor
          WHERE i.id = $1::uuid
            AND i.status NOT IN ('RESOLVED', 'CANCELLED')
          RETURNING i.id
       ),
       freed AS (
         UPDATE incident_responder_assignment a
            SET status = 'STOOD_DOWN'
           FROM cancelled c
          WHERE a.incident_id = c.id
            AND a.status IN ('CLAIMED', 'EN_ROUTE', 'ARRIVED')
          RETURNING a.id
       )
       SELECT (SELECT count(*) FROM cancelled)::int AS cancelled`,
      [incidentId, cancelledById ?? null],
    );
    return (rows[0]?.cancelled ?? 0) > 0;
  }

  // ---------------------------------------------------------------------
  // READS
  // ---------------------------------------------------------------------

  async findIncidentById(incidentId: string): Promise<IncidentEntity | null> {
    const [row] = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS} FROM incident i WHERE i.id = $1::uuid`,
      [incidentId],
    );
    return row ? toIncident(row) : null;
  }

  /**
   * Incidents in any of the given statuses, newest first, one cursor page at a
   * time. The open-incident index covers non-terminal statuses only, so
   * lookups for RESOLVED / CANCELLED lean on the created_at index instead.
   * Throws InvalidCursorError for a bad cursor.
   */
  async findIncidentsByStatus(
    statuses: IncidentStatus[],
    { limit, cursor }: PageOptions = {},
  ): Promise<CursorPage<IncidentEntity>> {
    if (statuses.length === 0) return { items: [], nextCursor: null };

    const size = clampLimit(limit);
    const params: unknown[] = [statuses];
    const keyset = keysetPredicate(cursor, params, 'i.created_at', 'i.id', '<');
    params.push(size + 1);

    const rows = await queryRows<IncidentRowWithCursor>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS},
              ${cursorTsSql('i.created_at')} AS ${CURSOR_COLUMN}
         FROM incident i
        WHERE i.status = ANY($1::incident_status_enum[])
          ${keyset}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const page = toPage(rows, size, (r) => ({ t: r.cursor_t, id: r.id }));
    return {
      items: page.items.map((r) => toIncident(stripCursorColumn(r))),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Log rows for a command center: incidents ever escalated to it, or
   * claimed by one of its responders, newest first, one cursor page at a time.
   * incident_logs.escalated_command_center_id only shows the LATEST
   * escalation, so a re-escalated incident would vanish from the first
   * center's log; hence the history lookup.
   * Throws InvalidCursorError for a bad cursor.
   */
  async findIncidentLogsByCommandCenter(
    commandCenterId: string,
    { limit, cursor }: PageOptions = {},
  ): Promise<CursorPage<IncidentLogEntity>> {
    const size = clampLimit(limit);
    const params: unknown[] = [commandCenterId];
    const keyset = keysetPredicate(
      cursor,
      params,
      'l.detected_at',
      'l.incident_id',
      '<',
    );
    params.push(size + 1);

    const rows = await queryRows<IncidentLogRow>(
      this.db,
      `SELECT l.*, ${cursorTsSql('l.detected_at')} AS ${CURSOR_COLUMN}
         FROM incident_logs l
        WHERE (EXISTS (SELECT 1 FROM incident_escalation e
                        WHERE e.incident_id = l.incident_id
                          AND e.command_center_id = $1::uuid)
            OR EXISTS (SELECT 1 FROM user_account u
                        WHERE u.id = l.claimed_by_id
                          AND u.command_center_id = $1::uuid))
          ${keyset}
        ORDER BY l.detected_at DESC, l.incident_id DESC
        LIMIT $${params.length}`,
      params,
    );

    const page = toPage(rows, size, (r) => ({
      t: r.cursor_t,
      id: r.incident_id,
    }));
    return {
      items: page.items.map((r) => toIncidentLog(stripCursorColumn(r))),
      nextCursor: page.nextCursor,
    };
  }
}
