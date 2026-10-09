import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BrevoProvider {
  private readonly logger = new Logger(BrevoProvider.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Dispatches transactional email via Brevo REST API over HTTPS (Port 443).
   */
  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    const apiKey = this.configService.getOrThrow<string>('BREVO_API_KEY');
    const senderEmail = this.configService.getOrThrow<string>('EMAIL_FROM');

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'BANTAI Command Center', email: senderEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`Brevo API error [${response.status}]: ${errorBody}`);
      throw new InternalServerErrorException(
        `Failed to dispatch email via Brevo API: ${response.statusText}`,
      );
    }

    this.logger.log(
      `Email successfully dispatched via Brevo REST API to ${to}`,
    );
  }
}
