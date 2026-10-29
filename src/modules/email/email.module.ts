import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ResendProvider } from './providers/resend.provider';
import { EmailOtpService } from './email-otp.service';

@Module({
  providers: [
    EmailService,
    ResendProvider,
    EmailOtpService,
  ],
  exports: [EmailService, EmailOtpService],
})
export class EmailModule {}