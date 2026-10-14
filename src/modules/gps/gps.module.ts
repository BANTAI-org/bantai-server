import { Module } from '@nestjs/common';
import { GpsGateway } from './gps.gateway';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  providers: [GpsGateway],
  exports: [GpsGateway],
})
export class GpsModule {}
