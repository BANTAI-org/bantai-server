import {
  Injectable,
  Inject,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { RESEND_CLIENT } from './providers/resend.provider'; // Update this path to match your structure

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Low-level send. Purpose-specific methods below should be preferred
   * so the copy/branding for each email type lives in one place.
   *
   * The sender address comes from EMAIL_FROM, which MUST match your
   * newly verified domain in Resend.
   *
   * @param to Recipient email address.
   * @param subject Email subject line.
   * @param html Full HTML body.
   * @throws {InternalServerErrorException} If the Resend API fails.
   */
  async sendEmail(to: string, subject: string, html: string) {
    const from = this.configService.getOrThrow<string>('EMAIL_FROM');

    try {
      const { data, error } = await this.resend.emails.send({
        from,
        to,
        subject,
        html,
      });

      // Resend returns API errors (e.g., 403, 429) inside the resolved object,
      // it does not throw an exception for them. We must check this manually.
      if (error) {
        this.logger.error(
          `Resend failed to send "${subject}" to ${to}: ${error.message}`,
        );
        throw new InternalServerErrorException(
          `Email failed to send: ${error.message}`,
        );
      }

      return data;
    } catch (err: unknown) {
      // This only catches network-level failures or SDK crashes
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Unexpected error sending "${subject}" to ${to}: ${message}`,
      );
      throw new InternalServerErrorException(
        `Email failed to send: ${message}`,
      );
    }
  }

  /**
   * Builds an absolute, correctly-encoded link back to the app using
   * FRONTEND_URL from config.
   *
   * @param path Route path, e.g. '/activate' or '/reset-password'.
   * @param rawToken The UNHASHED token.
   */
  private buildActionUrl(path: string, rawToken: string): string {
    const baseUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const url = new URL(path, baseUrl);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }

  /**
   * Sends the account-activation email containing a single-use link.
   *
   * @param to Recipient email address (the newly provisioned user).
   * @param rawToken Unhashed activation token.
   */
  async sendActivationEmail(to: string, rawToken: string): Promise<void> {
    const activationUrl = this.buildActionUrl('/activate', rawToken);

    const html = `
      <p>Welcome to BANTAI! Your account has been created.</p>
      <p>Click the link below to activate your account and set your password:</p>
      <p><a href="${activationUrl}">Activate your account</a></p>
      <p>This link will expire in 24 hours. If you didn't expect this email, you can safely ignore it.</p>
    `;

    await this.sendEmail(to, 'Activate your BANTAI account', html);
  }

  /**
   * Sends the password-reset email containing a single-use link.
   *
   * @param to Recipient email address.
   * @param rawToken Unhashed password-reset token.
   */
  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const resetUrl = this.buildActionUrl('/reset-password', rawToken);

    const html = `
      <p>We received a request to reset your BANTAI account password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link will expire in 1 hour. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    `;

    await this.sendEmail(to, 'Reset your BANTAI password', html);
  }
}
