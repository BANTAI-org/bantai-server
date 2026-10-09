import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [AuditLogsController],
  exports: [AuditLogsService],
  imports: [AuthModule],
})
export class AuditLogsModule {}
