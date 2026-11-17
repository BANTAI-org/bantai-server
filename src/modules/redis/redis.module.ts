import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { RedisController } from './redis.controller';
import { RedisService } from './redis.service';
import { DistanceService } from './distance.service';
import { REDIS_CLIENT, redisProvider } from './provider/redis.provider';
import { DatabaseModule } from '../../database/database.module';

@Global()
@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [RedisController],
  providers: [redisProvider, RedisService, DistanceService],
  exports: [REDIS_CLIENT, RedisService, DistanceService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
