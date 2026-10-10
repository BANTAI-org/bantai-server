import { Module } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsRepository } from './audit-logs.repository';
import { AuditLogsController } from './audit-logs.controller';

@Module({
  imports: [AuthModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, AuditLogsRepository],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
