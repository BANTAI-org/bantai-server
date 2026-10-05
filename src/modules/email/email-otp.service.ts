import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/provider/redis.provider';
import { EmailService } from './email.service';

export const EMAIL_OTP_TTL_SECONDS = 10 * 60;

const codeKey = (purpose: string, email: string): string =>
  `otp:email:${purpose}:${email}`;

/**
 * The stored value is a hash only so raw codes never sit in Redis dumps or
 * logs. A 6-digit hash is trivially brute-forced offline, so it adds no
 * real protection: the TTL and the caller's attempt limit do that job.
 */
const digest = (purpose: string, email: string, code: string): string =>
  createHash('sha256').update(`${purpose}:${email}:${code}`).digest('hex');

/** Email OTPs: Redis holds the code, Resend delivers it. Single use, 10 min. */
@Injectable()
export class EmailOtpService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly emailService: EmailService,
  ) {}

  /** `purpose` namespaces codes so one flow's code can't be used in another. */
  async send(email: string, purpose: string): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const key = codeKey(purpose, email);

    // Replaces any earlier code: only the newest one is valid.
    await this.redis.set(
      key,
      digest(purpose, email, code),
      'EX',
      EMAIL_OTP_TTL_SECONDS,
    );

    try {
      await this.emailService.sendOtpEmail(
        email,
        code,
        EMAIL_OTP_TTL_SECONDS / 60,
      );
    } catch (error: unknown) {
      await this.redis.del(key);
      throw error;
    }
  }

  /** True only for the live code; a correct code is consumed. */
  async verify(email: string, purpose: string, code: string): Promise<boolean> {
    const key = codeKey(purpose, email);
    const stored = await this.redis.get(key);
    if (stored === null) return false;

    const expected = Buffer.from(stored);
    const received = Buffer.from(digest(purpose, email, code));
    const ok =
      expected.length === received.length &&
      timingSafeEqual(expected, received);

    if (ok) await this.redis.del(key);
    return ok;
  }
}
