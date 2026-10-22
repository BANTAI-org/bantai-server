import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserAuthRow } from './interfaces/user-auth-row.interface';
import { Role } from '../../common/enums/role-enum';
import { ActivationStateRow } from './interfaces/activation-state-row.interface';
import { CreateActivationTokenData } from './types/create-activation-token.types';
import { AccountTokenPurposeEnum } from './enums/account-token-purpose.enum';
import { AuthProviderEnum } from '../responders/enums/auth-provider.enum';
import { UpdatePasswordData } from './interfaces/update-password.interface';
import { PasswordType } from './types/get-password.type';
import {
  AccountStatusEnum,
  AccountStatusInterface,
} from './enums/account-status.enum';

@Injectable()
export class AuthRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * @description Finds a user by their email address for local login.
   * Includes account_status to reject pending accounts before password checks.
   * @param {string} email - The user's email.
   * @returns {Promise<UserAuthRow | null>} The user row, or null if not found.
   */
  async findUserByEmail(email: string): Promise<UserAuthRow | null> {
    const sql = `
      SELECT id, password_hash, role, account_status, deleted_at, command_center_id
      FROM user_account 
      WHERE email = $1 AND deleted_at IS NULL
      LIMIT 1;
    `;
    const { rows } = await this.db.query<UserAuthRow>(sql, [email]);
    return rows[0] || null;
  }

  /**
   * @description Retrieves the current account status of a user by email.
   * @param {string} email - The user's email.
   * @returns {Promise<AccountStatusEnum | null>} The account status, or null.
   */
  async getAccountStatus(email: string): Promise<AccountStatusEnum | null> {
    const sql =
      'SELECT account_status FROM user_account WHERE email = $1 LIMIT 1';
    const result = await this.db.query<AccountStatusInterface>(sql, [email]);
    return result.rows[0]?.account_status ?? null;
  }

  /**
   * @description Finds a user by their ID. Used for refreshing tokens and session validation.
   * @param {string} id - The user's UUID.
   * @returns {Promise<UserAuthRow | null>} The user row, or null if not found.
   */
  async findUserById(id: string): Promise<UserAuthRow | null> {
    const sql = `
      SELECT id, email, password_hash, role, account_status, deleted_at, command_center_id
      FROM user_account
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1;
    `;
    const { rows } = await this.db.query<UserAuthRow>(sql, [id]);
    return rows[0] || null;
  }

  /**
   * @description Creates a new refresh session.
   * For non-super accounts, it enforces a single active session by deleting
   * all previous sessions before inserting the new one.
   * @param {string} userId - The user's UUID.
   * @param {string} refreshTokenHash - The hashed refresh token.
   * @param {Date} expiresAt - The token's expiration date.
   * @param {Role} role - The user's role (Super admins keep multiple sessions).
   * @returns {Promise<void>}
   */
  async createSession(
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
    role: Role,
  ): Promise<void> {
    if (role !== Role.SUPER) {
      await this.db.query(`DELETE FROM user_session WHERE user_id = $1;`, [
        userId,
      ]);
    }

    const sql = `
      INSERT INTO user_session (user_id, refresh_token_hash, expires_at)
      VALUES ($1, $2, $3);
    `;
    await this.db.query(sql, [userId, refreshTokenHash, expiresAt]);
  }

  /**
   * @description Finds a user by a valid, non-expired, non-revoked refresh token hash.
   * @param {string} hash - The hashed refresh token.
   * @returns {Promise<UserAuthRow | null>} The user row if the session is valid, else null.
   */
  async findUserByRefreshTokenHash(hash: string): Promise<UserAuthRow | null> {
    const sql = `
      SELECT u.id, u.password_hash, u.role, u.deleted_at, u.command_center_id 
      FROM user_account u
      INNER JOIN user_session s ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1 
        AND s.expires_at > NOW() 
        AND s.is_revoked = false 
        AND u.deleted_at IS NULL
      LIMIT 1;
    `;
    const { rows } = await this.db.query<UserAuthRow>(sql, [hash]);
    return rows[0] || null;
  }

  /**
   * @description Destroys a specific session by deleting it from the database.
   * @param {string} hash - The hashed refresh token.
   * @returns {Promise<boolean>} True if a session was deleted, false otherwise.
   */
  async deleteSessionByHash(hash: string): Promise<boolean> {
    const sql = `DELETE FROM user_session WHERE refresh_token_hash = $1`;
    const result = await this.db.query(sql, [hash]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * @description Checks the activation status of a user account.
   * @param {string} id - The user's UUID.
   * @returns {Promise<ActivationStateRow>} The account status row.
   */
  async checkUserActivationState(id: string): Promise<ActivationStateRow> {
    const sql = 'SELECT account_status FROM user_account WHERE id = $1';
    const { rows } = await this.db.query<ActivationStateRow>(sql, [id]);
    return rows[0];
  }

  /**
   * @description Finds a live action token (activation/reset) and returns its owner.
   * Ensures the token is not expired, not used, and matches the account's current state.
   * @param {string} tokenHash - The hashed token.
   * @param {AccountTokenPurposeEnum} purpose - The token's intended purpose.
   * @returns {Promise<{ user_id: string; email: string } | null>}
   */
  async findLiveTokenWithUser(
    tokenHash: string,
    purpose: AccountTokenPurposeEnum,
  ): Promise<{ user_id: string; email: string } | null> {
    const sql = `
      SELECT t.user_id, u.email
      FROM account_action_token t
      JOIN user_account u ON u.id = t.user_id
      WHERE t.token_hash = $1
        AND t.purpose = $2
        AND t.used_at IS NULL
        AND t.expires_at > now()
        AND u.deleted_at IS NULL
        AND (
          (t.purpose = 'activation'     AND u.account_status = 'pending_activation')
          OR (t.purpose = 'password_reset' AND u.account_status = 'active')
        )
      LIMIT 1;
    `;
    const { rows } = await this.db.query<{ user_id: string; email: string }>(
      sql,
      [tokenHash, purpose],
    );
    return rows[0] || null;
  }

  /**
   * @description Looks up a user by third-party provider identity (e.g., Google).
   * @param {string} providerId - The ID from the provider (e.g., Google ID).
   * @param {AuthProviderEnum} authProvider - The provider name.
   * @returns {Promise<UserAuthRow | null>}
   */
  async findUserBySocialIdentity(
    providerId: string,
    authProvider: AuthProviderEnum,
  ): Promise<UserAuthRow | null> {
    const sql = `
      SELECT u.id, u.password_hash, u.role, u.account_status, u.deleted_at, u.command_center_id
      FROM user_account u
      INNER JOIN user_identity i ON u.id = i.user_id
      WHERE i.provider_id = $1 
        AND i.provider = $2
        AND i.deleted_at IS NULL
        AND u.deleted_at IS NULL
      LIMIT 1;
    `;
    const { rows } = await this.db.query<UserAuthRow>(sql, [
      providerId,
      authProvider,
    ]);
    return rows[0] || null;
  }

  /**
   * @description Issues a new action token, replacing any live token for the same user/purpose.
   * Runs in a transaction with row locking to prevent race conditions.
   * @param {CreateActivationTokenData} data - The token data.
   * @returns {Promise<void>}
   */
  async replaceAccountActionToken(
    data: CreateActivationTokenData,
  ): Promise<void> {
    const { user_id, purpose, token_hash, expires_at } = data;
    await this.db.withTransaction(async (client) => {
      await client.query(
        `SELECT id FROM user_account WHERE id = $1 FOR UPDATE`,
        [user_id],
      );
      await client.query(
        `DELETE FROM account_action_token
         WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
        [user_id, purpose],
      );
      await client.query(
        `INSERT INTO account_action_token(user_id, purpose, token_hash, expires_at)
         VALUES($1, $2, $3, $4)`,
        [user_id, purpose, token_hash, expires_at],
      );
    });
  }

  /**
   * @description Consumes an action token, updates the user's password, activates the account,
   * and destroys all active sessions. Runs entirely in a single transaction.
   * @param {string} tokenHash - The hashed token.
   * @param {AccountTokenPurposeEnum} purpose - The token's purpose.
   * @param {string} passwordHash - The newly hashed password.
   * @returns {Promise<{ user_id: string } | null>}
   */
  async consumeTokenAndSetPassword(
    tokenHash: string,
    purpose: AccountTokenPurposeEnum,
    passwordHash: string,
  ): Promise<{ user_id: string } | null> {
    return this.db.withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `SELECT t.id, t.user_id
         FROM account_action_token t
         JOIN user_account u ON u.id = t.user_id
         WHERE t.token_hash = $1
           AND t.purpose = $2
           AND t.used_at IS NULL
           AND t.expires_at > now()
           AND u.deleted_at IS NULL
           AND (
             (t.purpose = 'activation'     AND u.account_status = 'pending_activation')
             OR (t.purpose = 'password_reset' AND u.account_status = 'active')
           )
         FOR UPDATE OF t`,
        [tokenHash, purpose],
      );
      if (!rows[0]) return null;

      const { id: tokenId, user_id } = rows[0];

      await client.query(
        `UPDATE account_action_token SET used_at = now() WHERE id = $1`,
        [tokenId],
      );
      await client.query(
        `UPDATE user_account
         SET password_hash = $1, account_status = 'active'
         WHERE id = $2`,
        [passwordHash, user_id],
      );
      await client.query(`DELETE FROM user_session WHERE user_id = $1`, [
        user_id,
      ]);

      if (purpose === AccountTokenPurposeEnum.ACTIVATION) {
        const authResult = await client.query<{
          f_name: string;
          l_name: string;
          command_center_id: string;
        }>(
          `SELECT f_name, l_name, command_center_id FROM user_account WHERE id = $1`,
          [user_id],
        );
        let actorName: string | null = null;
        let commandCenterId: string | null = null;
        if (authResult.rows.length > 0) {
          const { f_name, l_name, command_center_id } = authResult.rows[0];
          actorName = `${f_name} ${l_name}`;
          commandCenterId = command_center_id;
        }

        await client.query(
          `INSERT INTO system_audit_log(
             actor_id, actor_name, command_center_id, action, target_entity, target_id, old_payload, new_payload
           ) VALUES (
             $1, $2, $3, 'ACTIVATE_ACCOUNT', 'user_account', $4, null, null
           )`,
          [user_id, actorName, commandCenterId, user_id],
        );
      }

      return { user_id };
    });
  }

  /**
   * @description Atomically rotates a refresh session. Deletes the old session
   * and inserts the new one in a transaction.
   * @param {string} userId - The user's UUID.
   * @param {string} oldHash - The old refresh token hash.
   * @param {string} newHash - The new refresh token hash.
   * @param {Date} expiresAt - The new expiration date.
   * @param {Role} role - The user's role.
   * @returns {Promise<void>}
   */
  async atomicSession(
    userId: string,
    oldHash: string,
    newHash: string,
    expiresAt: Date,
    role: Role,
  ): Promise<void> {
    await this.db.withTransaction(async (client) => {
      if (role !== Role.SUPER) {
        await client.query(`DELETE FROM user_session WHERE user_id = $1;`, [
          userId,
        ]);
      } else {
        await client.query(
          `DELETE FROM user_session WHERE refresh_token_hash = $1;`,
          [oldHash],
        );
      }

      await client.query(
        `INSERT INTO user_session (user_id, refresh_token_hash, expires_at)
         VALUES ($1, $2, $3);`,
        [userId, newHash, expiresAt],
      );
    });
  }

  /**
   * @description Updates the last sign-in timestamp for a social identity.
   * @param {string} userId - The user's UUID.
   * @param {AuthProviderEnum} provider - The provider name.
   * @param {string} providerId - The provider-specific ID.
   * @returns {Promise<void>}
   */
  async updateIdentityLastSignIn(
    userId: string,
    provider: AuthProviderEnum,
    providerId: string,
  ): Promise<void> {
    const sql = `
      UPDATE user_identity
      SET last_sign_in_at = NOW()
      WHERE user_id = $1 AND provider = $2 AND provider_id = $3 AND deleted_at IS NULL;
    `;
    await this.db.query(sql, [userId, provider, providerId]);
  }

  /**
   * @description Inserts a new social identity record linked to an existing user.
   * @param {string} userId - The user's UUID.
   * @param {AuthProviderEnum} provider - The provider name.
   * @param {string} providerId - The provider-specific ID.
   * @param {string} providerEmail - The email from the provider.
   * @returns {Promise<void>}
   */
  async linkUserIdentity(
    userId: string,
    provider: AuthProviderEnum,
    providerId: string,
    providerEmail: string,
  ): Promise<void> {
    const sql = `
      INSERT INTO user_identity (user_id, provider, provider_id, provider_email)
      VALUES ($1, $2, $3, $4);
    `;
    await this.db.query(sql, [userId, provider, providerId, providerEmail]);
  }

  /**
   * @description Soft-deletes a linked social identity for a user.
   * @param {string} userId - The user's UUID.
   * @param {AuthProviderEnum} provider - The provider name.
   * @returns {Promise<boolean>} True if unlinked, false if not found.
   */
  async unlinkUserIdentity(
    userId: string,
    provider: AuthProviderEnum,
  ): Promise<boolean> {
    const sql = `
      UPDATE user_identity
      SET deleted_at = NOW()
      WHERE user_id = $1 AND provider = $2 AND deleted_at IS NULL;
    `;
    const { rowCount } = await this.db.query(sql, [userId, provider]);
    return (rowCount ?? 0) > 0;
  }

  /**
   * @description Checks authentication methods (password vs linked providers)
   * to prevent a user from locking themselves out.
   * @param {string} userId - The user's UUID.
   * @returns {Promise<{ hasPassword: boolean; linkedProvidersCount: number }>}
   */
  async getUserAuthSummary(userId: string): Promise<{
    hasPassword: boolean;
    linkedProvidersCount: number;
  }> {
    const sql = `
      SELECT 
        (u.password_hash IS NOT NULL) AS "hasPassword",
        COUNT(i.id)::int AS "linkedProvidersCount"
      FROM user_account u
      LEFT JOIN user_identity i ON u.id = i.user_id AND i.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL
      GROUP BY u.id;
    `;
    const { rows } = await this.db.query<{
      hasPassword: boolean;
      linkedProvidersCount: number;
    }>(sql, [userId]);

    return rows[0] ?? { hasPassword: false, linkedProvidersCount: 0 };
  }

  /**
   * @description Updates the user's password hash.
   * @param {UpdatePasswordData} data - Contains user ID and new hashed password.
   * @returns {Promise<boolean>} True if updated, false otherwise.
   */
  async updatePassword(data: UpdatePasswordData): Promise<boolean> {
    const { id, new_password } = data;
    const sql = 'UPDATE user_account SET password_hash = $1 WHERE id = $2';
    const result = await this.db.query(sql, [new_password, id]);
    return result.rowCount === 1;
  }

  /**
   * @description Retrieves the user's current password hash.
   * @param {string} id - The user's UUID.
   * @returns {Promise<PasswordType>}
   */
  async getPassword(id: string): Promise<PasswordType> {
    const sql = 'SELECT password_hash FROM user_account WHERE id = $1';
    const result = await this.db.query<PasswordType>(sql, [id]);
    return result.rows[0];
  }
}
