import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { FcmService } from './fcm.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, FcmService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
