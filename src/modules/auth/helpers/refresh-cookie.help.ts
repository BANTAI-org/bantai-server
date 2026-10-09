// auth/refresh-cookie.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import ms from 'ms';
import { ReplyWithCookie } from '../interfaces/reply-w-cookie.interface';
export const REFRESH_COOKIE_NAME = 'refresh_token';

@Injectable()
export class RefreshCookieService {
  private readonly cookiePath: string;

  constructor(private readonly configService: ConfigService) {
    const apiPrefix = this.configService
      .get<string>('API_PREFIX', '/api/v1')
      .replace(/\/$/, '');
    this.cookiePath = `${apiPrefix}/auth/refresh`;
  }

  set(response: FastifyReply, refreshToken: string): void {
    const refreshTtl = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRATION',
    );
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    (response as ReplyWithCookie).setCookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: this.cookiePath,
      maxAge: ms(refreshTtl as ms.StringValue) / 1000,
    });
  }
}
