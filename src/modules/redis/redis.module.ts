import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { RedisController } from './redis.controller';
import { RedisService } from './redis.service';
import { REDIS_CLIENT, redisProvider } from './provider/redis.provider';
/**
 * Global on purpose: infrastructure that the drivers, responders and
 * dispatch code all need, without each module re-importing it.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RedisController],
  providers: [redisProvider, RedisService],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
