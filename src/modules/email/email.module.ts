import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ResendProvider } from './providers/resend.provider';
import { NodemailerProvider } from './providers/nodemailer.provider';
import { BrevoProvider } from './providers/brevo.provider';

@Module({
  providers: [EmailService, ResendProvider, NodemailerProvider, BrevoProvider],
  exports: [EmailService],
})
export class EmailModule {}
