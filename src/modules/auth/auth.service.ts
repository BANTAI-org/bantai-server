import {
  Injectable,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import ms from 'ms';
import { AuthRepository } from './auth.repository';
import { EmailPasswordDto } from './dto/email-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { Role } from '../../common/enums/role-enum';
import { AuthTokens } from './interfaces/auth-token.interface';
import { EmailService } from '../email/email.service';
import { CreateActivationTokenData } from './types/create-activation-token.types';
import { AccountTokenPurposeEnum } from './enums/account-token-purpose.enum';
import { AccountStatusEnum } from './enums/account-status.enum';
import { GoogleService } from './providers/google.service';
import { AuthProviderEnum } from '../responders/enums/auth-provider.enum';

interface SignedTokens extends AuthTokens {
  refreshTokenHash: string;
  refreshExpiresAt: Date;
}

const TOKEN_TTL_CONFIG_KEY: Record<AccountTokenPurposeEnum, string> = {
  [AccountTokenPurposeEnum.ACTIVATION]: 'ACTIVATION_TOKEN_EXPIRATION',
  [AccountTokenPurposeEnum.PASSWORD_RESET]: 'PASSWORD_RESET_TOKEN_EXPIRATION',
};

export const INVALID_LINK_MESSAGE =
  'This link has expired or has already been used.';

const BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly googleService: GoogleService,
  ) {}

  /**
   * @description Constructs the JWT payload.
   * @param {string} userId - The user's UUID.
   * @param {Role} role - The user's role.
   * @param {string | null} [commandCenterId] - Optional command center ID.
   * @returns {JwtPayload}
   */
  private createPayload(
    userId: string,
    role: Role,
    commandCenterId?: string | null,
  ): JwtPayload {
    return {
      sub: userId,
      role: role,
      ...(commandCenterId && { command_center_id: commandCenterId }),
    };
  }

  /**
   * @description Hashes a token using SHA-256.
   * @param {string} token - The raw token.
   * @returns {string} The hashed token.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * @description Signs a new access token and refresh token pair.
   * @param {string} userId - The user's UUID.
   * @param {Role} role - The user's role.
   * @param {string | null} [commandCenterId] - Optional command center ID.
   * @returns {Promise<SignedTokens>} The signed tokens and refresh metadata.
   */
  private async signTokens(
    userId: string,
    role: Role,
    commandCenterId?: string | null,
  ): Promise<SignedTokens> {
    const payload = this.createPayload(userId, role, commandCenterId);

    const accessTtl = this.configService.getOrThrow<string>('JWT_EXPIRATION');
    const refreshTtl = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRATION',
    );

    const accessExpiresInSec = Math.floor(
      ms(accessTtl as ms.StringValue) / 1000,
    );
    const refreshExpiresInSec = Math.floor(
      ms(refreshTtl as ms.StringValue) / 1000,
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: accessExpiresInSec,
      }),
      this.jwtService.signAsync(
        { sub: userId, jti: randomUUID() },
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshExpiresInSec,
        },
      ),
    ]);

    const refreshTokenHash = this.hashToken(refreshToken);
    const refreshExpiresAt = new Date(
      Date.now() + ms(refreshTtl as ms.StringValue),
    );

    return { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt };
  }

  /**
   * @description Generates tokens and persists a new session in the database.
   * @param {string} userId - The user's UUID.
   * @param {Role} role - The user's role.
   * @param {string | null} [commandCenterId] - Optional command center ID.
   * @returns {Promise<AuthTokens>}
   */
  async generateTokens(
    userId: string,
    role: Role,
    commandCenterId?: string | null,
  ): Promise<AuthTokens> {
    const { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt } =
      await this.signTokens(userId, role, commandCenterId);

    await this.authRepository.createSession(
      userId,
      refreshTokenHash,
      refreshExpiresAt,
      role,
    );

    return { accessToken, refreshToken };
  }

  /**
   * @description Authenticates a user using email and password.
   * @param {EmailPasswordDto} dto - The login credentials.
   * @returns {Promise<AuthTokens>}
   * @throws {UnauthorizedException} If credentials are invalid.
   */
  async manualLogin(dto: EmailPasswordDto): Promise<AuthTokens> {
    const { email, password } = dto;

    try {
      const user = await this.authRepository.findUserByEmail(email);

      if (!user) {
        this.logger.warn(`Failed login attempt for email: ${email}`);
        throw new UnauthorizedException('Invalid email or password.');
      }

      if (user.deleted_at !== null) {
        this.logger.warn(`Deactivated account tried to authenticate: ${email}`);
        throw new UnauthorizedException('Invalid email or password.');
      }

      if (!user.password_hash) {
        this.logger.warn(
          `Account with no local password attempted local login: ${email}`,
        );
        throw new UnauthorizedException('Invalid email or password.');
      }

      const isPasswordValid = await bcrypt.compare(
        password,
        user.password_hash,
      );
      if (!isPasswordValid) {
        this.logger.warn(`Invalid password for email: ${email}`);
        throw new UnauthorizedException('Invalid email or password.');
      }

      return await this.generateTokens(
        user.id,
        user.role,
        user.command_center_id,
      );
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error(`Error during local login for email ${email}`, err);
      throw new InternalServerErrorException('Authentication failed.');
    }
  }

  /**
   * @description Generates a raw action token (activation/reset) and saves its hash.
   * @param {string} userId - The user's UUID.
   * @param {AccountTokenPurposeEnum} purpose - The token's purpose.
   * @returns {Promise<string>} The raw token to be sent via email.
   */
  private async generateActionToken(
    userId: string,
    purpose: AccountTokenPurposeEnum,
  ): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const ttlConfigKey = TOKEN_TTL_CONFIG_KEY[purpose];
    const ttl = this.configService.getOrThrow<string>(ttlConfigKey);
    const expiresAt = new Date(Date.now() + ms(ttl as ms.StringValue));

    const data: CreateActivationTokenData = {
      user_id: userId,
      purpose,
      token_hash: tokenHash,
      expires_at: expiresAt,
    };

    await this.authRepository.replaceAccountActionToken(data);

    return rawToken;
  }

  /**
   * @description Creates an activation token and sends it via email.
   * @param {string} userId - The user's UUID.
   * @param {string} email - The user's email.
   * @returns {Promise<void>}
   */
  async createActivationToken(userId: string, email: string): Promise<void> {
    const state = await this.authRepository.checkUserActivationState(userId);

    if (
      !state ||
      state.account_status !== AccountStatusEnum.PENDING_ACTIVATION
    ) {
      this.logger.warn(
        `Activation token requested for non-pending account: ${userId}`,
      );
      throw new BadRequestException('Account is not pending activation.');
    }

    try {
      const rawToken = await this.generateActionToken(
        userId,
        AccountTokenPurposeEnum.ACTIVATION,
      );

      await this.emailService.sendActivationEmail(email, rawToken);
    } catch (err: unknown) {
      this.logger.error(
        `Failed to create/send activation token for user ${userId}`,
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException(
        'Failed to send activation email.',
      );
    }
  }

  /**
   * @description Creates a password reset token and sends it via email.
   * @param {string} userId - The user's UUID.
   * @param {string} email - The user's email.
   * @returns {Promise<void>}
   */
  async createPasswordResetToken(userId: string, email: string): Promise<void> {
    const state = await this.authRepository.checkUserActivationState(userId);

    if (!state || state.account_status !== AccountStatusEnum.ACTIVE) {
      this.logger.warn(
        `Password reset requested for non-active account: ${userId}`,
      );
      throw new BadRequestException('Account is not active.');
    }

    try {
      const rawToken = await this.generateActionToken(
        userId,
        AccountTokenPurposeEnum.PASSWORD_RESET,
      );

      await this.emailService.sendPasswordResetEmail(email, rawToken);
    } catch (err: unknown) {
      this.logger.error(
        `Failed to create/send password reset token for user ${userId}`,
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException(
        'Failed to send password reset email.',
      );
    }
  }

  /**
   * @description Masks an email address for display (e.g., u***@example.com).
   * @param {string} email - The email to mask.
   * @returns {string} The masked email.
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}***@${domain}`;
  }

  /**
   * @description Verifies an action token and returns the masked email of its owner.
   * @param {string} rawToken - The raw token.
   * @param {AccountTokenPurposeEnum} purpose - The token's purpose.
   * @returns {Promise<{ maskedEmail: string }>}
   */
  private async verifyActionToken(
    rawToken: string,
    purpose: AccountTokenPurposeEnum,
  ): Promise<{ maskedEmail: string }> {
    const tokenHash = this.hashToken(rawToken);
    const match = await this.authRepository.findLiveTokenWithUser(
      tokenHash,
      purpose,
    );

    if (!match) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }

    return { maskedEmail: this.maskEmail(match.email) };
  }

  /**
   * @description Verifies an account activation token.
   * @param {string} rawToken - The raw token from the email link.
   * @returns {Promise<{ maskedEmail: string }>}
   */
  async verifyActivationToken(
    rawToken: string,
  ): Promise<{ maskedEmail: string }> {
    return this.verifyActionToken(rawToken, AccountTokenPurposeEnum.ACTIVATION);
  }

  /**
   * @description Verifies a password reset token.
   * @param {string} rawToken - The raw token from the email link.
   * @returns {Promise<{ maskedEmail: string }>}
   */
  async verifyPasswordResetToken(
    rawToken: string,
  ): Promise<{ maskedEmail: string }> {
    return this.verifyActionToken(
      rawToken,
      AccountTokenPurposeEnum.PASSWORD_RESET,
    );
  }

  /**
   * @description Redeems an action token by consuming it and setting a new password.
   * @param {string} rawToken - The raw token.
   * @param {string} newPassword - The new plaintext password.
   * @param {AccountTokenPurposeEnum} purpose - The token's purpose.
   * @returns {Promise<void>}
   */
  private async redeemActionToken(
    rawToken: string,
    newPassword: string,
    purpose: AccountTokenPurposeEnum,
  ): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    const result = await this.authRepository.consumeTokenAndSetPassword(
      tokenHash,
      purpose,
      passwordHash,
    );

    if (!result) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }
  }

  /**
   * @description Activates an account and sets its initial password.
   * @param {string} rawToken - The raw token.
   * @param {string} newPassword - The new plaintext password.
   * @returns {Promise<void>}
   */
  async activateAccount(rawToken: string, newPassword: string): Promise<void> {
    await this.redeemActionToken(
      rawToken,
      newPassword,
      AccountTokenPurposeEnum.ACTIVATION,
    );
  }

  /**
   * @description Resets a user's password using a valid reset token.
   * @param {string} rawToken - The raw token.
   * @param {string} newPassword - The new plaintext password.
   * @returns {Promise<void>}
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    await this.redeemActionToken(
      rawToken,
      newPassword,
      AccountTokenPurposeEnum.PASSWORD_RESET,
    );
  }

  /**
   * @description Refreshes an access token using a valid refresh token.
   * Rotates the refresh token (old one is deleted, new one is issued).
   * @param {string} token - The raw refresh token.
   * @returns {Promise<AuthTokens>}
   * @throws {UnauthorizedException} If the token is invalid, expired, or revoked.
   */
  async refreshToken(token: string): Promise<AuthTokens> {
    try {
      await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch (err) {
      this.logger.warn(`Refresh token verification failed: ${err}`);
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const oldHash = this.hashToken(token);

    try {
      const user =
        await this.authRepository.findUserByRefreshTokenHash(oldHash);

      if (!user) {
        this.logger.warn(
          'Attempted token refresh with unrecognized, expired, or revoked hash.',
        );
        throw new UnauthorizedException('Invalid session.');
      }

      const { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt } =
        await this.signTokens(user.id, user.role, user.command_center_id);

      await this.authRepository.atomicSession(
        user.id,
        oldHash,
        refreshTokenHash,
        refreshExpiresAt,
        user.role,
      );

      return { accessToken, refreshToken };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error('Error during token refresh', err);
      throw new InternalServerErrorException('Token refresh failed.');
    }
  }

  /**
   * @description Logs out a user by destroying their current session.
   * @param {string} refreshToken - The raw refresh token from the client's cookie.
   * @returns {Promise<void>}
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      const tokenHash = this.hashToken(refreshToken);
      await this.authRepository.deleteSessionByHash(tokenHash);
    } catch (err: unknown) {
      this.logger.error(
        `Error during logout`,
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException('Logout failed.');
    }
  }

  /**
   * @description Authenticates a user using a Google ID token.
   * @param {string} socialIdToken - The Google ID token.
   * @returns {Promise<AuthTokens>}
   */
  async googleLogin(socialIdToken: string): Promise<AuthTokens> {
    try {
      const googleIdentity =
        await this.googleService.verifyIdToken(socialIdToken);

      const user = await this.authRepository.findUserBySocialIdentity(
        googleIdentity.googleId,
        AuthProviderEnum.GOOGLE,
      );

      if (!user) {
        this.logger.warn(
          `Unregistered Google identity attempted login: ${googleIdentity.email}`,
        );
        throw new NotFoundException('Account not found.');
      }

      if (user.deleted_at !== null) {
        this.logger.warn(
          `Deactivated Google user attempted login: ${googleIdentity.email}`,
        );
        throw new UnauthorizedException('Account deactivated.');
      }

      await this.authRepository.updateIdentityLastSignIn(
        user.id,
        AuthProviderEnum.GOOGLE,
        googleIdentity.googleId,
      );

      return await this.generateTokens(
        user.id,
        user.role,
        user.command_center_id,
      );
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }

      this.logger.error('Error during Google authentication', err);
      throw new InternalServerErrorException('Google authentication failed.');
    }
  }

  /**
   * @description Links a social provider account to an existing user.
   * @param {string} userId - The user's UUID.
   * @param {AuthProviderEnum} provider - The provider name.
   * @param {string} socialIdToken - The provider's ID token.
   * @returns {Promise<void>}
   */
  async linkSocialAccount(
    userId: string,
    provider: AuthProviderEnum,
    socialIdToken: string,
  ): Promise<void> {
    if (provider === AuthProviderEnum.LOCAL) {
      throw new BadRequestException(
        'Use password update to configure local authentication.',
      );
    }

    let providerId: string;
    let email: string;

    if (provider === AuthProviderEnum.GOOGLE) {
      const verified = await this.googleService.verifyIdToken(socialIdToken);
      providerId = verified.googleId;
      email = verified.email;
    } else {
      throw new BadRequestException(
        `Provider ${provider} is not supported for linking.`,
      );
    }

    const existingUser = await this.authRepository.findUserBySocialIdentity(
      providerId,
      provider,
    );

    if (existingUser) {
      if (existingUser.id === userId) {
        throw new ConflictException(
          'This account is already linked to your profile.',
        );
      }
      throw new ConflictException(
        'This social account is already linked to another user.',
      );
    }

    try {
      await this.authRepository.linkUserIdentity(
        userId,
        provider,
        providerId,
        email,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Failed to link ${provider} identity for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException(
        'Failed to link identity provider.',
      );
    }
  }

  /**
   * @description Unlinks a social provider from a user's account.
   * Prevents lockout if it's the user's only authentication method.
   * @param {string} userId - The user's UUID.
   * @param {AuthProviderEnum} provider - The provider name.
   * @returns {Promise<void>}
   */
  async unlinkSocialAccount(
    userId: string,
    provider: AuthProviderEnum,
  ): Promise<void> {
    if (provider === AuthProviderEnum.LOCAL) {
      throw new BadRequestException('Cannot unlink local provider.');
    }

    const { hasPassword, linkedProvidersCount } =
      await this.authRepository.getUserAuthSummary(userId);

    if (!hasPassword && linkedProvidersCount <= 1) {
      throw new BadRequestException(
        'Cannot unlink your only sign-in method. Set a password or link another provider first.',
      );
    }

    const unlinked = await this.authRepository.unlinkUserIdentity(
      userId,
      provider,
    );

    if (!unlinked) {
      throw new NotFoundException(
        `No active ${provider} identity found to unlink.`,
      );
    }
  }

  /**
   * @description Checks if an account exists and is in a valid state for authentication.
   * @param {string} email - The user's email.
   * @returns {Promise<boolean>} True if valid.
   * @throws {NotFoundException | ForbiddenException | UnauthorizedException}
   */
  async checkAccountExistenceAndStatus(email: string): Promise<boolean> {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      throw new NotFoundException('No account associated with this email.');
    }

    let status: AccountStatusEnum | null = null;
    try {
      status = await this.authRepository.getAccountStatus(cleanEmail);
    } catch (err: unknown) {
      this.logger.error(
        `Error checking account status for email ${cleanEmail}`,
        err instanceof Error ? err.stack : err,
      );
      throw new InternalServerErrorException(
        'Failed to verify account status.',
      );
    }

    if (!status) {
      this.logger.warn(`Account check failed — email not found: ${cleanEmail}`);
      throw new NotFoundException('No account associated with this email.');
    }

    if (status === AccountStatusEnum.DEACTIVATED) {
      this.logger.warn(
        `Account check failed — deactivated account: ${cleanEmail}`,
      );
      throw new ForbiddenException('This account has been deactivated.');
    }

    if (status === AccountStatusEnum.PENDING_ACTIVATION) {
      this.logger.warn(
        `Account check failed — pending activation: ${cleanEmail}`,
      );
      throw new UnauthorizedException('Account is pending activation.');
    }

    return true;
  }
}
