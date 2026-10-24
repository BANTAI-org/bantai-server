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
import { PeerDispatchService } from './peer-dispatch.service';
import { TrackingService } from './incident-tracking.service';
import { WaveDispatchService } from '../wave-dispatch/wave-dispatch.service';
import { SlaSweeperService } from './sla-sweeper.service'; // 👈 MUST IMPORT

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    RedisModule,
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
    PeerDispatchService,
    WaveDispatchService,
    SlaSweeperService,
  ],
  exports: [IncidentService, TrackingService],
})
export class IncidentModule {}
