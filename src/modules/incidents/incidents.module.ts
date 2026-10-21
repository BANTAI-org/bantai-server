import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { IncidentController } from './incidents.controller';
import { IncidentReportController } from './incidents-report.controller';
import { IncidentGateway } from './incidents.gateway';
import { IncidentService } from './incidents.service';
import { IncidentRepository } from './incidents.repository';
import { IncidentReportRepository } from './incidents-report.repository';
import { TrackingService } from './incident-tracking.service';
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    // Provides RedisService (used by TrackingService.computeTracking) and
    // REDIS_CLIENT (used by TrackingService for the claimant hash and the
    // gps:updates:* psubscribe connection). Must export both.
    RedisModule,
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
    TrackingService,
  ],
  exports: [IncidentService, TrackingService],
})
export class IncidentModule {}
