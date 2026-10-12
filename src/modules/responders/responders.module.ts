import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SmsModule } from '../sms/sms.module';
import { ResponderRepository } from './responders.repository';
import { ResponderService } from './responders.service';
import { RespondersController } from './responders.controller';
@Module({
  imports: [AuthModule, AuditLogsModule, SmsModule],
  providers: [ResponderService, ResponderRepository],
  controllers: [RespondersController],
  exports: [ResponderService],
})
export class RespondersModule {}
