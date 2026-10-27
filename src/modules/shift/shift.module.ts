import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';
import { ShiftRepository } from './shift.repository';

/**
 * Owns the periodic shift sweeper (responder + driver) and the
 * GET /shift, POST /shift/extend surface.
 *
 * ScheduleModule.forRoot() is already registered at the app root for
 * SlaSweeperService, so no per-module schedule setup is needed here.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule],
  controllers: [ShiftController],
  providers: [ShiftService, ShiftRepository],
  exports: [ShiftService],
})
export class ShiftModule {}
