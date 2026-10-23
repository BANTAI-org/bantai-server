import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Role } from '../../common/enums/role-enum';
import { GeoPoint } from '../../common/interfaces/geo-location.interface';
import { CreateNewResponderUserAccount } from './types/create-new-user.types';
import { UserIdType } from './types/user-id.types';
import { CreateResponderProfileData } from './types/create-responder-profile.type';
import { AccountStatusEnum } from '../auth/enums/account-status.enum';
import { DutyChangeResult } from './types/duty-change-result';
import { AvailabilityStatusEnum } from './enums/availability-status.enum';

export interface ResponderAccountPatch {
  m_number?: string;
  phone_verified_at?: Date;
}

export interface ResponderProfileRow {
  id: string;
  f_name: string;
  l_name: string;
  m_name: string | null;
  email: string;
  role: Role;
  command_center_id: string | null;
  m_number: string | null;
  command_center_name: string | null;
  phone_verified_at: Date | null;
}

/** A responder may only go on/off duty within this distance of their command center. */
const DUTY_GEOFENCE_METERS = 50;

// Forgot-password types and constants
export interface ResponderPasswordTarget {
  id: string;
  email: string;
  m_number: string | null;
}

export interface ResponderResetIdentity {
  kind: 'id' | 'email' | 'm_number';
  value: string;
}

export const PASSWORD_RESET_LOOKUP: Record<
  ResponderResetIdentity['kind'],
  string
> = {
  id: 'id = $1',
  email: 'lower(email) = $1',
  m_number: 'm_number = $1',
};

const CHANGE_DUTY_SQL = `
  WITH target AS (
    SELECT p.user_id, p.availability,
           ST_Distance(
             cc.location,
             ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography
           ) AS distance_m
    FROM user_account u
    JOIN r_profile p ON p.user_id = u.id
    JOIN command_center cc ON cc.id = u.command_center_id
    WHERE u.id = $1 AND u.role = $4 AND u.deleted_at IS NULL
  ),
  updated AS (
    UPDATE r_profile p
    SET availability = $6::availability_status,
        shift_ends_at = $8::timestamptz,
        last_active_at = now(),
        last_known_location =
          ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography
    WHERE p.user_id IN (
            SELECT user_id FROM target
            WHERE availability = $5::availability_status
              AND distance_m <= $7::float8
          )
      AND p.availability = $5::availability_status
    RETURNING p.user_id
  )
  SELECT t.availability,
         t.distance_m,
         EXISTS (SELECT 1 FROM updated) AS updated
  FROM target t
`;

@Injectable()
export class ResponderRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Creates the user_account row, and — ONLY when profileData is
   * given — the matching r_profile row. profileData is omitted for
   * admin accounts: r_profile is responder-only data (agency,
   * call_sign, rank), and agency is NOT NULL in that table, so an
   * unconditional insert here would throw a raw Postgres constraint
   * violation the moment ResponderService creates an admin instead of
   * a responder.
   */
  async createResponderProfile(
    userData: CreateNewResponderUserAccount,
    profileData?: CreateResponderProfileData,
  ): Promise<UserIdType> {
    const { f_name, l_name, m_name, email, role, command_center_id } = userData;

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<UserIdType>(
        `INSERT INTO user_account(f_name, l_name, m_name, email, role, command_center_id, account_status)
         VALUES($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          f_name,
          l_name,
          m_name,
          email,
          role,
          command_center_id,
          AccountStatusEnum.PENDING_ACTIVATION,
        ],
      );
      const { id: user_id } = rows[0];

      if (profileData) {
        const { agency, call_sign, rank } = profileData;
        await client.query(
          `INSERT INTO r_profile(user_id, agency, call_sign, rank)
           VALUES($1, $2, $3, $4)`,
          [user_id, agency, call_sign, rank],
        );
      }

      return { id: user_id };
    });
  }

  async setOnDutyAvailability(
    id: string,
    location: GeoPoint,
    shiftEndsAt: Date | null = null,
  ): Promise<DutyChangeResult> {
    return this.changeDuty(
      id,
      AvailabilityStatusEnum.OFF_DUTY,
      AvailabilityStatusEnum.ON_DUTY,
      location,
      shiftEndsAt,
    );
  }

  async findCommandCenterIdByUserId(userId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ command_center_id: string }>(
      `SELECT command_center_id 
     FROM user_account 
     WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    return rows[0]?.command_center_id ?? null;
  }

  async setOffDutyAvailability(
    id: string,
    location: GeoPoint,
  ): Promise<DutyChangeResult> {
    return this.changeDuty(
      id,
      AvailabilityStatusEnum.ON_DUTY,
      AvailabilityStatusEnum.OFF_DUTY,
      location,
      null,
    );
  }

  /**
   * Timer expiry. Deliberately NOT geofenced. Returns the affected user ids
   * so the caller can push to them; also writes the 'shift_auto_ended' inbox row.
   */
  async expireDueShifts(): Promise<string[]> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `WITH expired AS (
         UPDATE r_profile
         SET availability = 'off_duty', shift_ends_at = NULL
         WHERE availability = 'on_duty' AND shift_ends_at <= now()
         RETURNING user_id
       ),
       notified AS (
         INSERT INTO notification (user_id, type, tone, title, body)
         SELECT user_id, 'shift_auto_ended', 'info', 'Shift ended',
                'Your duty timer ran out, so you were set off duty.'
         FROM expired
       )
       SELECT user_id FROM expired`,
      [],
    );
    return rows.map((row) => row.user_id);
  }

  private async changeDuty(
    id: string,
    from: AvailabilityStatusEnum,
    to: AvailabilityStatusEnum,
    { latitude, longitude }: GeoPoint,
    shiftEndsAt: Date | null,
  ): Promise<DutyChangeResult> {
    const { rows } = await this.db.query<{
      availability: AvailabilityStatusEnum;
      distance_m: number;
      updated: boolean;
    }>(CHANGE_DUTY_SQL, [
      id,
      longitude,
      latitude,
      Role.RESPONDER,
      from,
      to,
      DUTY_GEOFENCE_METERS,
      shiftEndsAt,
    ]);

    const row = rows[0];
    if (!row) return { status: 'NOT_FOUND' };
    if (row.updated) {
      return { status: 'UPDATED', distance_meters: row.distance_m };
    }
    if (row.availability !== from) {
      return { status: 'INVALID_STATE', availability: row.availability };
    }
    if (row.distance_m > DUTY_GEOFENCE_METERS) {
      return { status: 'OUT_OF_RANGE', distance_meters: row.distance_m };
    }
    // In range and in the right state, yet nothing changed: a concurrent change won.
    return { status: 'INVALID_STATE', availability: row.availability };
  }

  /**
   * Fetches the user profile for the given user ID.
   * Returns the user account details (including role and command center name).
   * Returns null if no user exists or if the user is soft-deleted.
   */
  async findProfileById(userId: string): Promise<ResponderProfileRow | null> {
    const PROFILE_SELECT_SQL = `
      SELECT
        u.id,
        u.f_name,
        u.l_name,
        u.m_name,
        u.email,
        u.role,
        u.command_center_id,
        u.m_number,
        cc.name AS command_center_name,
        u.phone_verified_at
      FROM user_account u
      LEFT JOIN command_center cc ON cc.id = u.command_center_id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
    `;

    const { rows } = await this.db.query<ResponderProfileRow>(
      PROFILE_SELECT_SQL,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Updates the responder's account information.
   * Only m_number and phone_verified_at can be updated through this method
   * to maintain data integrity for authority fields.
   */
  async updateUserAccount(
    userId: string,
    patch: ResponderAccountPatch,
  ): Promise<boolean> {
    const fields: string[] = [];
    const values: (string | Date)[] = [];

    if (patch.m_number !== undefined) {
      fields.push(`m_number = $${values.length + 1}`);
      values.push(patch.m_number);
    }
    if (patch.phone_verified_at !== undefined) {
      fields.push(`phone_verified_at = $${values.length + 1}`);
      values.push(patch.phone_verified_at);
    }
    if (fields.length === 0) return false;

    const userIdParameter = values.length + 1;
    values.push(userId, Role.RESPONDER);

    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE user_account
       SET ${fields.join(', ')}
       WHERE id = $${userIdParameter}
         AND role = $${userIdParameter + 1}
         AND deleted_at IS NULL
       RETURNING id`,
      values,
    );

    return rows.length > 0;
  }

  // ---------------------------------------------------------------
  // Forgot-password
  // ---------------------------------------------------------------

  /**
   * The live responder behind an id, email or phone number, but only if they
   * have a password to reset. Soft-deleted accounts and social-only
   * (Google/Apple) accounts return null.
   * Allows password reset for RESPONDER, ADMIN, and SUPER roles.
   */
  async findResponderForPasswordReset(
    identity: ResponderResetIdentity,
  ): Promise<ResponderPasswordTarget | null> {
    const { rows } = await this.db.query<ResponderPasswordTarget>(
      `SELECT id, email, m_number
       FROM user_account
       WHERE role IN ($2, $3, $4)
         AND deleted_at IS NULL
         AND password_hash IS NOT NULL
         AND ${PASSWORD_RESET_LOOKUP[identity.kind]}
       LIMIT 1`,
      [identity.value, Role.RESPONDER, Role.ADMIN, Role.SUPER],
    );
    return rows[0] ?? null;
  }

  /**
   * Sets the new password hash and signs the responder out everywhere (revokes
   * every live refresh session), in ONE transaction. Unlike updatePassword,
   * this is the account-recovery path. Returns false if no live responder
   * matched, in which case nothing changed.
   * Works for RESPONDER, ADMIN, and SUPER roles.
   */
  async resetPasswordAndRevokeSessions(
    id: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `UPDATE user_account SET password_hash = $1
         WHERE id = $2 AND role IN ($3, $4, $5) AND deleted_at IS NULL
         RETURNING id`,
        [passwordHash, id, Role.RESPONDER, Role.ADMIN, Role.SUPER],
      );
      if (rows.length === 0) return false;

      await client.query(
        `UPDATE user_session SET is_revoked = true
         WHERE user_id = $1 AND is_revoked = false`,
        [id],
      );
      return true;
    });
  }
}
