import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { Role } from '../../common/enums/role-enum';
import { UserIdType } from '../responders/types/user-id.types';
import { CreateDriverProfileData } from './types/create-driver-profile.types';
import { CreateDriverUserAccount } from './types/create-driver-account.type';
import { Queryable } from './util/queryable.utility';
import { DriverProfilePatch } from './types/patch-driver-identity.types';
import { UserAccountPatch } from './types/patch-user-account.type';
import { DriverProfileDataRow } from './types/driver-profile-data-row.type';
import {
  DriverPasswordTarget,
  ResetIdentity,
  ResetIdentityKind,
} from './types/password-reset-types';
import { DutyStatusEnum } from './enums/duty-status.enum';

const USER_PATCHABLE_COLUMNS: readonly (keyof UserAccountPatch)[] = [
  'f_name',
  'l_name',
  'm_name',
  'm_number',
  'phone_verified_at',
  'avatar_url', // <-- ADDED
];

const PROFILE_PATCHABLE_COLUMNS: readonly (keyof DriverProfilePatch)[] = [
  'service_provider',
  'service_id',
  'plate_number',
  'blood_type',
  'address',
  'date_of_birth',
  'emergency_contacts',
  'license_number',
  'license_expires_at',
  'years_riding',
  'fleet_operator_id',
  'vehicle_model',
  'vehicle_color',
  'medical_conditions',
];

const PASSWORD_RESET_LOOKUP: Record<ResetIdentityKind, string> = {
  id: 'id = $1',
  email: 'lower(email) = $1',
  m_number: 'm_number = $1',
};

const PROFILE_SELECT_SQL = `
  SELECT
    u.id, u.f_name, u.m_name, u.l_name, u.email, u.m_number, u.avatar_url,
    u.phone_verified_at,
    p.service_provider, p.service_id, p.fleet_operator_id, p.plate_number,
    p.blood_type, p.address,
    to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
    p.emergency_contacts, p.license_number,
    to_char(p.license_expires_at, 'YYYY-MM-DD') AS license_expires_at,
    p.years_riding, p.vehicle_model, p.vehicle_color, p.medical_conditions,
    p.data_sharing_consented_at,
    GREATEST(u.updated_at, p.updated_at) AS updated_at
  FROM user_account u
  JOIN d_profile p ON p.user_id = u.id
  WHERE u.id = $1 AND u.role = $2 AND u.deleted_at IS NULL
  LIMIT 1
`;

@Injectable()
export class DriverRepository {
  constructor(private readonly db: DatabaseService) {}

  async createDriverAccount(
    userData: CreateDriverUserAccount,
    profileData: CreateDriverProfileData,
  ): Promise<UserIdType> {
    const {
      f_name,
      l_name,
      m_name,
      email,
      m_number,
      auth_provider,
      provider_id,
      password_hash,
      phone_verified_at,
      email_verified_at,
    } = userData;

    const {
      service_provider,
      service_id,
      plate_number,
      blood_type,
      address,
      date_of_birth,
      emergency_contacts,
      license_number,
      license_expires_at,
      years_riding,
      fleet_operator_id,
      vehicle_model,
      vehicle_color,
      medical_conditions,
      data_sharing_consented_at,
    } = profileData;

    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<UserIdType>(
        `INSERT INTO user_account (
           f_name, l_name, m_name, email, m_number, role,
           password_hash, phone_verified_at, email_verified_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          f_name,
          l_name,
          m_name,
          email,
          m_number,
          Role.DRIVER,
          password_hash,
          phone_verified_at,
          email_verified_at,
        ],
      );
      const { id: user_id } = rows[0];

      if (auth_provider && provider_id) {
        await client.query(
          `INSERT INTO user_identity (user_id, provider, provider_id, provider_email)
           VALUES ($1, $2, $3, $4)`,
          [user_id, auth_provider, provider_id, email],
        );
      }

      await client.query(
        `INSERT INTO d_profile (
           user_id, service_provider, service_id, plate_number, blood_type,
           address, date_of_birth, emergency_contacts, license_number,
           license_expires_at, years_riding, fleet_operator_id,
           vehicle_model, vehicle_color, medical_conditions, data_sharing_consented_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          user_id,
          service_provider,
          service_id ?? null,
          plate_number,
          blood_type,
          address,
          date_of_birth,
          JSON.stringify(emergency_contacts),
          license_number,
          license_expires_at,
          years_riding,
          fleet_operator_id ?? null,
          vehicle_model,
          vehicle_color,
          medical_conditions,
          data_sharing_consented_at,
        ],
      );

      return { id: user_id };
    });
  }

  async findProfileById(
    userId: string,
    client?: Queryable,
  ): Promise<DriverProfileDataRow | null> {
    const executor: Queryable = client ?? this.db;
    const { rows } = await executor.query<DriverProfileDataRow>(
      PROFILE_SELECT_SQL,
      [userId, Role.DRIVER],
    );
    return rows[0] ?? null;
  }

  async updateUserAccount(
    userId: string,
    patch: UserAccountPatch,
    client?: Queryable,
  ): Promise<boolean> {
    const executor: Queryable = client ?? this.db;
    const params: unknown[] = [userId];
    const { sets, paramIndex } = this.collectAssignments(
      patch,
      USER_PATCHABLE_COLUMNS,
      params,
    );
    if (sets.length === 0) return false;

    if (
      paramIndex.m_number !== undefined &&
      paramIndex.phone_verified_at === undefined
    ) {
      sets.push(
        `"phone_verified_at" = CASE WHEN m_number IS DISTINCT FROM $${paramIndex.m_number} THEN NULL ELSE phone_verified_at END`,
      );
    }

    params.push(Role.DRIVER);
    const { rows } = await executor.query<{ id: string }>(
      `UPDATE user_account
       SET ${sets.join(', ')}
       WHERE id = $1 AND role = $${params.length} AND deleted_at IS NULL
       RETURNING id`,
      params,
    );

    return rows.length > 0;
  }

  async updateDriverProfile(
    userId: string,
    patch: DriverProfilePatch,
    client?: Queryable,
  ): Promise<boolean> {
    const executor: Queryable = client ?? this.db;
    const params: unknown[] = [userId];
    const { sets } = this.collectAssignments(
      patch,
      PROFILE_PATCHABLE_COLUMNS,
      params,
    );
    if (sets.length === 0) return false;

    const { rows } = await executor.query<{ user_id: string }>(
      `UPDATE d_profile
       SET ${sets.join(', ')}
       WHERE user_id = $1
         AND EXISTS (
           SELECT 1 FROM user_account u
           WHERE u.id = d_profile.user_id AND u.deleted_at IS NULL
         )
       RETURNING user_id`,
      params,
    );

    return rows.length > 0;
  }

  async patchDriverComposite(
    userId: string,
    accountPatch: UserAccountPatch,
    profilePatch: DriverProfilePatch,
  ): Promise<DriverProfileDataRow | null> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM user_account
         WHERE id = $1 AND role = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [userId, Role.DRIVER],
      );
      if (rows.length === 0) return null;

      await this.updateUserAccount(userId, accountPatch, client);
      await this.updateDriverProfile(userId, profilePatch, client);

      return this.findProfileById(userId, client);
    });
  }

  private collectAssignments(
    patch: object,
    columns: readonly string[],
    params: unknown[],
  ): { sets: string[]; paramIndex: Record<string, number> } {
    const source = patch as Record<string, unknown>;
    const sets: string[] = [];
    const paramIndex: Record<string, number> = {};

    for (const column of columns) {
      const value = source[column];
      if (value === undefined) continue;

      const isJson = column === 'emergency_contacts';
      params.push(isJson ? JSON.stringify(value) : value);
      paramIndex[column] = params.length;
      sets.push(`"${column}" = $${params.length}${isJson ? '::jsonb' : ''}`);
    }

    return { sets, paramIndex };
  }

  async findDriverForPasswordReset(
    identity: ResetIdentity,
  ): Promise<DriverPasswordTarget | null> {
    const { rows } = await this.db.query<DriverPasswordTarget>(
      `SELECT id, email, m_number
       FROM user_account
       WHERE role = $2
         AND deleted_at IS NULL
         AND password_hash IS NOT NULL
         AND ${PASSWORD_RESET_LOOKUP[identity.kind]}
       LIMIT 1`,
      [identity.value, Role.DRIVER],
    );
    return rows[0] ?? null;
  }

  async resetPasswordAndRevokeSessions(
    id: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `UPDATE user_account SET password_hash = $1
         WHERE id = $2 AND role = $3 AND deleted_at IS NULL
         RETURNING id`,
        [passwordHash, id, Role.DRIVER],
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

  async setDuty(
    id: string,
    status: DutyStatusEnum,
    shiftHours: number | null,
  ): Promise<{ dutyStatus: DutyStatusEnum; shiftEndsAt: Date | null } | null> {
    const sql = `
    UPDATE d_profile
    SET duty_status = $2::driver_duty,
        shift_ends_at = CASE
          WHEN $2::driver_duty = 'on_duty'
          THEN now() + ($3::int * interval '1 hour')
          ELSE NULL
        END
    WHERE user_id = $1
    RETURNING duty_status AS "dutyStatus", shift_ends_at AS "shiftEndsAt"
  `;
    const result = await this.db.query<{
      dutyStatus: DutyStatusEnum;
      shiftEndsAt: Date | null;
    }>(sql, [id, status, shiftHours]);
    return result.rows[0] ?? null;
  }
}
