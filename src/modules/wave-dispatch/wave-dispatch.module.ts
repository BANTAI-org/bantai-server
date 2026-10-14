import { Module } from '@nestjs/common';
import { WaveDispatchService } from './wave-dispatch.service';
import { IncidentRepository } from '../incidents/incidents.repository';
import { RedisService } from '../redis/redis.service';

@Module({
  providers: [WaveDispatchService, IncidentRepository, RedisService],
  exports: [WaveDispatchService],
})
export class WaveDispatchModule {}
