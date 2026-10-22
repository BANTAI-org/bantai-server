import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiCookieAuth,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import ms from 'ms';
import { AuthService, INVALID_LINK_MESSAGE } from './auth.service';
import { EmailPasswordDto } from './dto/email-password.dto';
import { ActionTokenPasswordDto } from './dto/action-token-password.dto';
import { ReplyWithCookie } from './interfaces/reply-w-cookie.interface';
import { AuthTokens } from './interfaces/auth-token.interface';
import { GoogleSsoDto } from './dto/google-sso.dto';

interface RequestWithCookies extends FastifyRequest {
  cookies: Record<string, string | undefined>;
}

const REFRESH_COOKIE_NAME = 'refresh_token';

// Raw account-action tokens are 64 hex chars; anything much longer is junk.
const MAX_ACTION_TOKEN_LENGTH = 128;

@ApiTags('Authentication')
@ApiBearerAuth('access-token')
@ApiCookieAuth('refresh_token')
@Controller('auth')
export class AuthController {
  private readonly refreshCookiePath: string;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    const apiPrefix = this.configService
      .get<string>('API_PREFIX', '/api/v1')
      .replace(/\/$/, '');
    this.refreshCookiePath = `${apiPrefix}/auth/refresh`;
  }

  @HttpCode(HttpStatus.OK)
  @Post('local/signin')
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({ type: EmailPasswordDto })
  @ApiResponse({
    status: 200,
    description:
      'Access and refresh tokens returned; refresh token set in httpOnly cookie',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async localSignIn(
    @Body() dto: EmailPasswordDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthTokens> {
    const tokens = await this.authService.manualLogin(dto);

    this.setRefreshTokenCookie(response, tokens.refreshToken);

    return tokens;
  }

  @HttpCode(HttpStatus.OK)
  @Post('google')
  @ApiOperation({ summary: 'Sign in with Google ID token' })
  @ApiBody({ type: GoogleSsoDto })
  @ApiResponse({
    status: 200,
    description:
      'Access and refresh tokens returned; refresh token set in httpOnly cookie',
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  async googleSignIn(
    @Body() dto: GoogleSsoDto,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthTokens> {
    const tokens = await this.authService.googleLogin(dto.idToken);

    this.setRefreshTokenCookie(response, tokens.refreshToken);

    return tokens;
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token cookie' })
  @ApiResponse({
    status: 200,
    description:
      'New access and refresh tokens returned; refresh token cookie rotated',
  })
  @ApiResponse({
    status: 401,
    description: 'No refresh token or invalid token',
  })
  async refresh(
    @Req() request: RequestWithCookies,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<AuthTokens> {
    const existingToken = request.cookies?.[REFRESH_COOKIE_NAME];

    if (!existingToken) {
      throw new UnauthorizedException('No refresh token provided.');
    }

    const tokens = await this.authService.refreshToken(existingToken);

    this.setRefreshTokenCookie(response, tokens.refreshToken);

    return tokens;
  }

  // ------------------------------------------------------------------
  // Session Management
  // ------------------------------------------------------------------

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiOperation({ summary: 'Log out and destroy the current session' })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
    schema: { example: { message: 'Logged out successfully.' } },
  })
  async logout(
    @Req() request: RequestWithCookies,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<{ message: string }> {
    const existingToken = request.cookies?.[REFRESH_COOKIE_NAME];

    // 1. Destroy the session in the database (if it exists)
    if (existingToken) {
      await this.authService.logout(existingToken);
    }

    // 2. Clear the httpOnly cookie from the browser
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    (response as ReplyWithCookie).setCookie(REFRESH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: this.refreshCookiePath,
      maxAge: 0, // Expire immediately
    });

    return { message: 'Logged out successfully.' };
  }

  // ------------------------------------------------------------------
  // Emailed-link flows (account activation / password reset).
  // ------------------------------------------------------------------

  @Get('verify-activation-token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Verify an account activation token (from email link)',
  })
  @ApiResponse({
    status: 200,
    description: 'Token valid; returns masked email',
    schema: { example: { maskedEmail: 'u***@example.com' } },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing token' })
  verifyActivationToken(
    @Query('token') token?: string,
  ): Promise<{ maskedEmail: string }> {
    return this.authService.verifyActivationToken(
      this.requireActionToken(token),
    );
  }

  @Get('verify-reset-token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Verify a password reset token (from email link)' })
  @ApiResponse({
    status: 200,
    description: 'Token valid; returns masked email',
    schema: { example: { maskedEmail: 'u***@example.com' } },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing token' })
  verifyResetToken(
    @Query('token') token?: string,
  ): Promise<{ maskedEmail: string }> {
    return this.authService.verifyPasswordResetToken(
      this.requireActionToken(token),
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('activate')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Activate account using token from email and set password',
  })
  @ApiBody({ type: ActionTokenPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Account activated successfully',
    schema: { example: { message: 'Account activated.' } },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async activate(
    @Body() dto: ActionTokenPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.activateAccount(dto.token, dto.password);
    return { message: 'Account activated.' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiBody({ type: ActionTokenPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
    schema: { example: { message: 'Password reset.' } },
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() dto: ActionTokenPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password reset.' };
  }

  private requireActionToken(token: unknown): string {
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > MAX_ACTION_TOKEN_LENGTH
    ) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }
    return token;
  }

  private setRefreshTokenCookie(
    response: FastifyReply,
    refreshToken: string,
  ): void {
    const refreshTtl = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRATION',
    );
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const maxAgeInSeconds = ms(refreshTtl as ms.StringValue) / 1000;

    (response as ReplyWithCookie).setCookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: this.refreshCookiePath,
      maxAge: maxAgeInSeconds,
    });
  }
}
