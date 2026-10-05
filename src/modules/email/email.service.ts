import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoProvider } from './providers/brevo.provider';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly brevoProvider: BrevoProvider,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Low-level send method. Delegates straight to Brevo REST API.
   *
   * @param to Recipient email address.
   * @param subject Email subject line.
   * @param html Full HTML body.
   */
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.brevoProvider.sendEmail(to, subject, html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Brevo provider failed to send "${subject}" to ${to}: ${message}`,
      );
      throw new InternalServerErrorException(
        `Email failed to send: ${message}`,
      );
    }
  }

  /**
   * Builds an absolute link back to the frontend application using FRONTEND_URL.
   */
  private buildActionUrl(path: string, rawToken: string): string {
    const baseUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const url = new URL(path, baseUrl);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }

  /**
   * Sends account-activation email with single-use token link.
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
   * Sends password-reset email with single-use token link.
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
