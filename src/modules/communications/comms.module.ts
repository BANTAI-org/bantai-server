import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { CommsController } from './comms.controller';
import { CommsService } from './comms.service';
import { CommsRepository } from './comms.repository';
import { CommsGateway } from './comms.gateway';
import { RealtimeKitService } from './realtimekit.service';

@Module({
  imports: [ConfigModule, DatabaseModule, JwtModule.register({})],
  controllers: [CommsController],
  providers: [CommsService, CommsRepository, CommsGateway, RealtimeKitService],
  exports: [CommsService],
})
export class CommunicationsModule {}
