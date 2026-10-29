import {
  Injectable,
  InternalServerErrorException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { RESEND_CLIENT } from './providers/resend.provider';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(RESEND_CLIENT)
    private readonly resend: Resend,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Core send method using Resend HTTP API.
   */
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      // 🚨 IMPORTANT: If you haven't verified a domain in Resend,
      // you MUST use 'onboarding@resend.dev' as the from address.
      // Note: With 'onboarding@resend.dev', you can ONLY send emails to
      // the email address you used to sign up for Resend.
      const fromAddress =
        this.configService.get<string>('EMAIL_FROM') || 'onboarding@resend.dev';

      const { data, error } = await this.resend.emails.send({
        from: `BANTAI <${fromAddress}>`,
        to,
        subject,
        html,
      });

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(
        `Email successfully sent via Resend (ID: ${data?.id}) to ${to}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Resend failed to send "${subject}" to ${to}: ${message}`,
      );
      throw new InternalServerErrorException(
        `Email failed to send: ${message}`,
      );
    }
  }

  private buildActionUrl(path: string, rawToken: string): string {
    const baseUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const url = new URL(path, baseUrl);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }

  async sendActivationEmail(to: string, rawToken: string): Promise<void> {
    const activationUrl = this.buildActionUrl('/activate', rawToken);

    // 🚨 Safety net for your demo. You can delete this after the presentation.
    console.log('====================================================');
    console.log('🚨 RAW ACTIVATION URL:', activationUrl);
    console.log('====================================================');

    const html = `
      <p>Welcome to BANTAI! Your account has been created.</p>
      <p>Click the link below to activate your account and set your password:</p>
      <p><a href="${activationUrl}">Activate your account</a></p>
      <p>This link will expire in 24 hours. If you didn't expect this email, you can safely ignore it.</p>
    `;

    await this.sendEmail(to, 'Activate your BANTAI account', html);
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const resetUrl = this.buildActionUrl('/reset-password', rawToken);

    const html = `
      <p>We received a request to reset your BANTAI account password.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link will expire in 1 hour. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
    `;

    await this.sendEmail(to, 'Reset your BANTAI password', html);
  }

  async sendOtpEmail(
    to: string,
    code: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const html = `
    <p>Your BANTAI verification code is:</p>
    <p style="font-size:28px;letter-spacing:6px;"><strong>${code}</strong></p>
    <p>This code will expire in ${expiresInMinutes} minutes. Never share it with anyone. BANTAI dispatch will never ask you for it.</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `;

    await this.sendEmail(to, 'Your BANTAI verification code', html);
  }
}
