import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ResendProvider } from './providers/resend.provider';
import { NodemailerProvider } from './providers/nodemailer.provider';
import { BrevoProvider } from './providers/brevo.provider';
import { EmailOtpService } from './email-otp.service';

@Module({
  providers: [
    EmailService,
    ResendProvider,
    NodemailerProvider,
    BrevoProvider,
    EmailOtpService,
  ],
  exports: [EmailService, EmailOtpService],
})
export class EmailModule {}
