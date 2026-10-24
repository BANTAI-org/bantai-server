import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommandCenterModule } from './modules/command-center/command-center.module';
import { EmailModule } from './modules/email/email.module';
import { RespondersModule } from './modules/responders/responders.module';
import { DriverModule } from './modules/drivers/drivers.module';
import { SmsModule } from './modules/sms/sms.module';
import { RedisModule } from './modules/redis/redis.module';
import { IncidentModule } from './modules/incidents/incidents.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { DevicesModule } from './modules/devices/devices.module';
import { GpsModule } from './modules/gps/gps.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { validate } from './config/env.config';
import { StorageModule } from './modules/storage/s3.module';
import { CommunicationsModule } from './modules/communications/comms.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AuthModule,
    CommandCenterModule,
    EmailModule,
    RespondersModule,
    DriverModule,
    SmsModule,
    RedisModule,
    IncidentModule,
    AuditLogsModule,
    DevicesModule,
    GpsModule,
    DashboardModule,
    StorageModule,
    CommunicationsModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
