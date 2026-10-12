import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { IncidentController } from './incidents.controller';
import { IncidentReportController } from './incidents-report.controller';
import { IncidentGateway } from './incidents.gateway';
import { IncidentService } from './incidents.service';
import { IncidentRepository } from './incidents.repository';
import { IncidentReportRepository } from './incidents-report.repository';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    // For the gateway: it verifies the socket's access token itself. The
    // secret is passed per call (as AuthService does), so no default is set.
    JwtModule.register({}),
    ConfigModule,
  ],
  controllers: [IncidentController, IncidentReportController],
  providers: [
    IncidentService,
    IncidentRepository,
    IncidentReportRepository,
    IncidentGateway,
  ],
  exports: [IncidentService],
})
export class IncidentModule {}
