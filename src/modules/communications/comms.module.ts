import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { CommsController } from './comms.controller';
import { CommsService } from './comms.service';
import { CommsRepository } from './comms.repository';
import { CommsGateway } from './comms.gateway';
import { RealtimeKitService } from './realtimekit.service';

/**
 * @description
 * The Communications Module.
 *
 * This module handles all real-time tactical communication for an incident:
 * 1. Text Chat (REST + Socket.IO)
 * 2. Voice Intercom (Cloudflare RealtimeKit WebRTC)
 * 3. Push-to-Talk Queue Management (PostgreSQL)
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    // Required for the WebSocket Gateway to verify the JWT handshake
    JwtModule.register({}),
  ],
  controllers: [CommsController],
  providers: [CommsService, CommsRepository, CommsGateway, RealtimeKitService],
  exports: [CommsService],
})
export class CommunicationsModule {}
