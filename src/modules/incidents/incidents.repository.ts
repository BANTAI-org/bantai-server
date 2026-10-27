import { DatabaseService } from '../../database/database.service';
import { CreateIncidentData } from './types/datas/incident-datas/create-incident-data.types';
import { IncidentLogEntity } from './interfaces/incident-log-entity.interface';
import { IncidentEntity } from './interfaces/incident-entity.interface';
import {
  DriverBrief,
  DriverBriefVisibility,
} from './interfaces/driver-brief.interface';
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

const VERIFIER_ROLES = `('responder', 'admin', 'super')`;

export const peerEligibleSql = (alias: string): string => `(
    ${alias}.threat_category = 'ASSIST'
    AND ${alias}.threat_type NOT IN ('GUN', 'BLADE')
    AND ${alias}.severity = 'MINOR'
    AND ${alias}.threat_level = 'CLEAR'
  )`;

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

const DRIVER_BRIEF_SELECT = `
  u.id                          AS user_id,
  u.f_name                      AS f_name,
  u.l_name                      AS l_name,
  u.m_name                      AS m_name,
  u.m_number                    AS m_number,
  u.avatar_url                  AS avatar_url,
  dp.blood_type                 AS blood_type,
  dp.plate_number               AS plate_number,
  dp.date_of_birth::text        AS date_of_birth,
  dp.license_number             AS license_number,
  dp.vehicle_model              AS vehicle_model,
  dp.vehicle_color              AS vehicle_color,
  dp.medical_conditions         AS medical_conditions,
  dp.emergency_contacts         AS emergency_contacts`;

const DRIVER_BRIEF_MINIMAL_SELECT = `
  u.id                          AS user_id,
  u.f_name                      AS f_name,
  u.l_name                      AS l_name`;

type IncidentRow = Omit<IncidentEntity, 'location' | 'driver'> & {
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

type DriverBriefFullRow = Omit<DriverBrief, 'visibility'>;

interface DriverBriefMinimalRow {
  user_id: string;
  f_name: string;
  l_name: string;
}

function toIncident(row: IncidentRow): IncidentEntity {
  const { lng, lat, ...rest } = row;
  return { ...rest, location: { longitude: lng, latitude: lat } };
}

@Injectable()
export class IncidentRepository {
  constructor(private readonly db: DatabaseService) {}

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
    )
      return 'forbidden';
    if (row.claimed_by_id === verifierId) return 'own_claim';
    return 'not_verifiable';
  }

  async resolveIncidentAndStandDownPeers(
    incidentId: string,
    outcome: IncidentOutcome,
    resolvedById: string,
  ): Promise<{ result: ResolveResult; standDownPeerIds: string[] }> {
    const [row] = await queryRows<{ resolved: number; revoked: string[] }>(
      this.db,
      `WITH changed AS (
         UPDATE incident i
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
                               AND u.role IN ('admin', 'super')))
          RETURNING i.id
       ),
       revoked AS (
         UPDATE incident_peer_response p
            SET status = 'stood_down',
                responded_at = COALESCE(p.responded_at, now())
           FROM changed c
          WHERE p.incident_id = c.id
            AND p.status IN ('en_route', 'on_scene')
          RETURNING p.peer_driver_id
       )
       SELECT (SELECT count(*) FROM changed)::int AS resolved,
              COALESCE((SELECT array_agg(peer_driver_id) FROM revoked), '{}') AS revoked`,
      [incidentId, outcome, resolvedById],
    );

    if ((row?.resolved ?? 0) > 0) {
      return { result: 'resolved', standDownPeerIds: row.revoked };
    }

    const [info] = await queryRows<{
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
    const none: string[] = [];
    if (!info) return { result: 'not_found', standDownPeerIds: none };
    const mayResolve =
      info.claimed_by_id === resolvedById ||
      info.resolver_role === 'admin' ||
      info.resolver_role === 'super';
    if (!mayResolve) return { result: 'forbidden', standDownPeerIds: none };
    if (
      !['ON_SCENE', 'AWAITING_VERIFICATION', 'ESCALATED'].includes(info.status)
    )
      return { result: 'not_resolvable', standDownPeerIds: none };
    if ((outcome as string) === 'unresolved')
      return { result: 'invalid_outcome', standDownPeerIds: none };
    return { result: 'needs_verification', standDownPeerIds: none };
  }

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
          RETURNING i.id, i.threat_type, i.threat_category, i.severity, i.threat_level
       ),${STAND_DOWN_INELIGIBLE_PEERS}
       SELECT (SELECT count(*) FROM changed)::int AS changed,
              COALESCE((SELECT array_agg(peer_driver_id) FROM revoked), '{}') AS revoked`,
      [incidentId, level, updatedById ?? null],
    );
    return row && row.changed > 0 ? row.revoked : null;
  }

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
          RETURNING i.id, i.threat_type, i.threat_category, i.severity, i.threat_level
       ),${STAND_DOWN_INELIGIBLE_PEERS}
       SELECT (SELECT count(*) FROM changed)::int AS changed,
              COALESCE((SELECT array_agg(peer_driver_id) FROM revoked), '{}') AS revoked`,
      [incidentId, severity, updatedById],
    );
    if (row && row.changed > 0) {
      return { result: 'updated', standDownPeerIds: row.revoked };
    }

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
    if (info.status === 'RESOLVED' || info.status === 'CANCELLED')
      return { result: 'closed', standDownPeerIds: none };
    return { result: 'unchanged', standDownPeerIds: none };
  }

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
            AND (
              $3::escalation_reason_enum = 'MANUAL_INTERVENTION'
              OR claimed_by_id IS NULL
            )
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

  async cancelIncidentAndStandDownPeers(
    incidentId: string,
    cancelledById?: string | null,
  ): Promise<{ cancelled: boolean; standDownPeerIds: string[] }> {
    const [row] = await queryRows<{ cancelled: number; revoked: string[] }>(
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
       ),
       revoked AS (
         UPDATE incident_peer_response p
            SET status = 'stood_down',
                responded_at = COALESCE(p.responded_at, now())
           FROM cancelled c
          WHERE p.incident_id = c.id
            AND p.status IN ('en_route', 'on_scene')
          RETURNING p.peer_driver_id
       )
       SELECT (SELECT count(*) FROM cancelled)::int AS cancelled,
              COALESCE((SELECT array_agg(peer_driver_id) FROM revoked), '{}') AS revoked`,
      [incidentId, cancelledById ?? null],
    );

    return {
      cancelled: (row?.cancelled ?? 0) > 0,
      standDownPeerIds: row?.revoked ?? [],
    };
  }

  async getDeviceAndDriver(
    identifier: string,
  ): Promise<{ deviceId: string; driverId: string | null } | null> {
    const [row] = await queryRows<{ id: string; driver_id: string | null }>(
      this.db,
      `SELECT id, driver_id 
         FROM device 
        WHERE (id::text = $1 OR hardware_serial = $1) 
          AND status = 'paired'`,
      [identifier],
    );

    if (!row) return null;
    return { deviceId: row.id, driverId: row.driver_id };
  }

  async findIncidentById(incidentId: string): Promise<IncidentEntity | null> {
    const [row] = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS} FROM incident i WHERE i.id = $1::uuid`,
      [incidentId],
    );
    return row ? toIncident(row) : null;
  }

  async findIncidentByIdForActor(
    incidentId: string,
    actorId: string,
  ): Promise<IncidentEntity | null> {
    const [row] = await queryRows<
      IncidentRow & { visibility: DriverBriefVisibility }
    >(
      this.db,
      `SELECT ${INCIDENT_COLUMNS},
              CASE
                WHEN i.claimed_by_id = $2::uuid THEN 'full'::text
                WHEN EXISTS (
                  SELECT 1 FROM incident_peer_response p
                   WHERE p.incident_id = i.id
                     AND p.peer_driver_id = $2::uuid
                     AND p.status IN ('en_route', 'on_scene')
                ) THEN 'full'::text
                ELSE 'minimal'::text
              END AS visibility
         FROM incident i
        WHERE i.id = $1::uuid`,
      [incidentId, actorId],
    );
    if (!row) return null;

    const { visibility, ...incidentRow } = row;
    const incident = toIncident(incidentRow);

    if (!incident.driver_id) return { ...incident, driver: null };
    if (incident.driver_id === actorId) return { ...incident, driver: null };

    const briefs = await this.findDriverBriefs(
      [incident.driver_id],
      visibility,
    );
    return {
      ...incident,
      driver: briefs.get(incident.driver_id) ?? null,
    };
  }

  async canUserViewIncident(
    incidentId: string,
    userId: string,
    role: string,
  ): Promise<boolean> {
    if (role === 'super') return true;
    const [row] = await queryRows<{ allowed: boolean }>(
      this.db,
      `SELECT (
         EXISTS (SELECT 1 FROM incident i WHERE i.id = $1::uuid AND (i.driver_id = $2::uuid OR i.claimed_by_id = $2::uuid))
         OR EXISTS (SELECT 1 FROM incident_responder_assignment a WHERE a.incident_id = $1::uuid AND a.responder_id = $2::uuid AND a.status IN ('OFFERED','CLAIMED','EN_ROUTE','ARRIVED'))
         OR EXISTS (SELECT 1 FROM incident_peer_response p WHERE p.incident_id = $1::uuid AND p.peer_driver_id = $2::uuid AND p.status IN ('notified','acknowledged','en_route','on_scene'))
         OR EXISTS (SELECT 1 FROM incident_escalation e JOIN user_account u ON u.id = $2::uuid WHERE e.incident_id = $1::uuid AND e.closed_at IS NULL AND u.role = 'admin' AND u.command_center_id = e.command_center_id)
       ) AS allowed`,
      [incidentId, userId],
    );
    return row?.allowed === true;
  }

  async findOpenIncidentsByDriver(driverId: string): Promise<IncidentEntity[]> {
    const rows = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS}
       FROM incident i
      WHERE i.driver_id = $1::uuid
        AND i.status NOT IN ('RESOLVED', 'CANCELLED')
      ORDER BY i.created_at DESC, i.id DESC`,
      [driverId],
    );
    return rows.map(toIncident);
  }

  async findCurrentAssignment(
    responderId: string,
  ): Promise<IncidentEntity | null> {
    const [row] = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS}
       FROM incident i
      WHERE i.claimed_by_id = $1::uuid
        AND i.status IN ('CLAIMED', 'EN_ROUTE', 'ON_SCENE', 'AWAITING_VERIFICATION', 'ESCALATED')
      ORDER BY i.claimed_at DESC, i.id DESC
      LIMIT 1`,
      [responderId],
    );
    if (!row) return null;
    const [enriched] = await this.attachDriverBriefs([toIncident(row)], 'full');
    return enriched;
  }

  async findPendingOffers(responderId: string): Promise<IncidentEntity[]> {
    const rows = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS}
       FROM incident i
       JOIN incident_responder_assignment a ON a.incident_id = i.id
      WHERE a.responder_id = $1::uuid
        AND a.status = 'OFFERED'
        AND i.status IN ('DISPATCHING', 'CLAIMED', 'ESCALATED')
      ORDER BY a.offered_at DESC`,
      [responderId],
    );
    return this.attachDriverBriefs(rows.map(toIncident), 'minimal');
  }

  async findAssignmentHistory(
    responderId: string,
    limit: number,
    offset: number,
  ): Promise<IncidentEntity[]> {
    const rows = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS}
       FROM incident i
      WHERE i.claimed_by_id = $1::uuid
        AND i.status IN ('RESOLVED', 'CANCELLED', 'CLAIMED', 'EN_ROUTE', 'ON_SCENE', 'AWAITING_VERIFICATION', 'ESCALATED')
      ORDER BY i.claimed_at DESC, i.id DESC
      LIMIT $2 OFFSET $3`,
      [responderId, limit, offset],
    );
    return this.attachDriverBriefs(rows.map(toIncident), 'full');
  }

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
      `SELECT ${INCIDENT_COLUMNS}, ${cursorTsSql('i.created_at')} AS ${CURSOR_COLUMN}
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
        WHERE (EXISTS (SELECT 1 FROM incident_escalation e WHERE e.incident_id = l.incident_id AND e.command_center_id = $1::uuid)
            OR EXISTS (SELECT 1 FROM user_account u WHERE u.id = l.claimed_by_id AND u.command_center_id = $1::uuid))
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

  async isIncidentUnclaimed(incidentId: string): Promise<boolean> {
    const [row] = await queryRows<{ status: string }>(
      this.db,
      `SELECT status FROM incident WHERE id = $1::uuid`,
      [incidentId],
    );
    return row?.status === 'DISPATCHING' || row?.status === 'DETECTED';
  }

  async createDispatchWave(
    incidentId: string,
    radiusMeters: number,
  ): Promise<string> {
    const rows = await queryRows<{ id: string }>(
      this.db,
      `WITH next_wave AS (
         SELECT COALESCE(MAX(wave_number) + 1, 1) AS wave_num 
         FROM incident_dispatch_wave 
         WHERE incident_id = $1::uuid
       )
       INSERT INTO incident_dispatch_wave (incident_id, wave_number, radius_meters)
       SELECT $1::uuid, wave_num, $2::int FROM next_wave
       ON CONFLICT (incident_id, wave_number) DO NOTHING
       RETURNING id`,
      [incidentId, radiusMeters],
    );

    if (rows.length > 0) return rows[0].id;

    const [existing] = await queryRows<{ id: string }>(
      this.db,
      `SELECT id FROM incident_dispatch_wave 
       WHERE incident_id = $1::uuid AND radius_meters = $2::int 
       ORDER BY wave_number DESC LIMIT 1`,
      [incidentId, radiusMeters],
    );
    if (!existing) throw new Error('Failed to create or find dispatch wave');
    return existing.id;
  }

  async createWaveAssignments(
    incidentId: string,
    waveId: string,
    responders: { user_id: string; distance_meters: number }[],
  ): Promise<string[]> {
    if (responders.length === 0) return [];
    const userIds = responders.map((r) => r.user_id);
    const distances = responders.map((r) => r.distance_meters);

    const rows = await queryRows<{ responder_id: string }>(
      this.db,
      `INSERT INTO incident_responder_assignment (
         incident_id, wave_id, responder_id, origin, distance_meters, status
       )
       SELECT $1::uuid, $2::uuid, unnest($3::uuid[]), 'WAVE_OFFER'::assignment_origin_enum, unnest($4::numeric[]), 'OFFERED'::assignment_status_enum
       ON CONFLICT (incident_id, responder_id) DO NOTHING
       RETURNING responder_id`,
      [incidentId, waveId, userIds, distances],
    );

    return rows.map((r) => r.responder_id);
  }

  async findFirstCommandCenterId(): Promise<string | null> {
    const [row] = await queryRows<{ id: string }>(
      this.db,
      `SELECT id FROM command_center LIMIT 1`,
      [],
    );
    return row?.id ?? null;
  }

  async findOrphanedIncidents(thresholdSeconds: number): Promise<string[]> {
    const rows = await queryRows<{ id: string }>(
      this.db,
      `SELECT id FROM incident 
       WHERE status = 'DISPATCHING' 
         AND created_at < NOW() - INTERVAL '1 second' * $1
       LIMIT 10`,
      [thresholdSeconds],
    );
    return rows.map((r) => r.id);
  }

  async findStalledClaims(thresholdSeconds: number): Promise<string[]> {
    const rows = await queryRows<{ id: string }>(
      this.db,
      `SELECT id FROM incident
        WHERE status IN ('CLAIMED', 'EN_ROUTE')
          AND updated_at < NOW() - INTERVAL '1 second' * $1
        LIMIT 10`,
      [thresholdSeconds],
    );
    return rows.map((r) => r.id);
  }

  async findDispatchingIncidents(): Promise<IncidentEntity[]> {
    const rows = await queryRows<IncidentRow>(
      this.db,
      `SELECT ${INCIDENT_COLUMNS}
         FROM incident i
        WHERE i.status = 'DISPATCHING'
          AND i.created_at > NOW() - INTERVAL '5 minutes'
        ORDER BY i.created_at ASC`,
      [],
    );
    return rows.map(toIncident);
  }

  async filterOnDutyResponders(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await queryRows<{ user_id: string }>(
      this.db,
      `SELECT p.user_id FROM r_profile p
       JOIN user_account u ON u.id = p.user_id
       WHERE p.user_id = ANY($1::uuid[])
         AND p.availability = 'on_duty'
         AND u.deleted_at IS NULL
         AND u.account_status = 'active'`,
      [userIds],
    );
    return rows.map((r) => r.user_id);
  }

  async filterOnDutyDrivers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await queryRows<{ user_id: string }>(
      this.db,
      `SELECT p.user_id FROM d_profile p
       JOIN user_account u ON u.id = p.user_id
       WHERE p.user_id = ANY($1::uuid[])
         AND p.duty_status = 'on_duty'
         AND u.deleted_at IS NULL
         AND u.account_status = 'active'`,
      [userIds],
    );
    return rows.map((r) => r.user_id);
  }

  // ==================================================================
  // NEW: FCM recipient lists + center-assigned dispatch
  // ==================================================================

  /**
   * Responders who currently hold an active claim on this incident.
   *
   * The RESOLVED branch of the incident_after_change trigger inserts a
   * notification row for exactly this set:
   *   WHERE status IN ('CLAIMED','EN_ROUTE','ARRIVED')
   * IncidentService.resolveIncident uses this query to derive the FCM
   * recipient list, so the push reaches the same responders who got the
   * inbox row. Keep the status list in lockstep with the trigger.
   */
  async getActiveResponderIdsOnIncident(incidentId: string): Promise<string[]> {
    const rows = await queryRows<{ responder_id: string }>(
      this.db,
      `SELECT responder_id
         FROM incident_responder_assignment
        WHERE incident_id = $1::uuid
          AND status IN ('CLAIMED', 'EN_ROUTE', 'ARRIVED')`,
      [incidentId],
    );
    return rows.map((r) => r.responder_id);
  }

  /**
   * Direct dispatch from a command center, bypassing the wave engine.
   *
   * The DB trigger handle_center_assignment fires on this INSERT and:
   *   * writes a system_audit_log row (action = ASSIGN_RESPONDER)
   *   * inserts the inbox notification for the responder
   *     (type = dispatch_assigned)
   * So the inbox half is already handled — the service only has to
   * emit the FCM push (with skipInbox: true) after this returns.
   *
   * Inserted with status = OFFERED, so the responder claims via the
   * existing POST /incidents/:id/claim path and the state machine takes
   * over from there. Throws 23505 (uq_assignment_per_responder) if the
   * responder already has any assignment row on this incident, and 23503
   * if the responder_id doesn't exist.
   */
  async createCenterAssignment(
    incidentId: string,
    responderId: string,
    assignedById: string,
  ): Promise<string> {
    const rows = await queryRows<{ id: string }>(
      this.db,
      `INSERT INTO incident_responder_assignment (
         incident_id, responder_id, origin, assigned_by_id, status
       )
       VALUES (
         $1::uuid, $2::uuid,
         'CENTER_ASSIGNED'::assignment_origin_enum,
         $3::uuid,
         'OFFERED'::assignment_status_enum
       )
       RETURNING id`,
      [incidentId, responderId, assignedById],
    );
    return rows[0].id;
  }

  // ==================================================================
  // Driver brief (responder-facing enrichment)
  // ==================================================================

  private async findDriverBriefs(
    driverIds: string[],
    visibility: DriverBriefVisibility,
  ): Promise<Map<string, DriverBrief>> {
    if (driverIds.length === 0) return new Map();

    if (visibility === 'minimal') {
      const rows = await queryRows<DriverBriefMinimalRow>(
        this.db,
        `SELECT ${DRIVER_BRIEF_MINIMAL_SELECT}
           FROM user_account u
          WHERE u.id = ANY($1::uuid[])
            AND u.deleted_at IS NULL`,
        [driverIds],
      );
      const map = new Map<string, DriverBrief>();
      for (const row of rows) {
        map.set(row.user_id, {
          ...row,
          m_name: null,
          m_number: null,
          avatar_url: null,
          blood_type: null,
          plate_number: null,
          date_of_birth: null,
          license_number: null,
          vehicle_model: null,
          vehicle_color: null,
          medical_conditions: null,
          emergency_contacts: null,
          visibility: 'minimal',
        });
      }
      return map;
    }

    const rows = await queryRows<DriverBriefFullRow>(
      this.db,
      `SELECT ${DRIVER_BRIEF_SELECT}
         FROM user_account u
         JOIN d_profile dp ON dp.user_id = u.id
        WHERE u.id = ANY($1::uuid[])
          AND u.deleted_at IS NULL`,
      [driverIds],
    );
    const map = new Map<string, DriverBrief>();
    for (const row of rows) {
      map.set(row.user_id, { ...row, visibility: 'full' });
    }
    return map;
  }

  private async attachDriverBriefs(
    incidents: IncidentEntity[],
    visibility: DriverBriefVisibility,
  ): Promise<IncidentEntity[]> {
    if (incidents.length === 0) return incidents;

    const driverIds = [
      ...new Set(
        incidents
          .map((i) => i.driver_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (driverIds.length === 0) {
      return incidents.map((i) => ({ ...i, driver: null }));
    }

    const briefs = await this.findDriverBriefs(driverIds, visibility);
    return incidents.map((i) => ({
      ...i,
      driver: i.driver_id ? (briefs.get(i.driver_id) ?? null) : null,
    }));
  }
}
