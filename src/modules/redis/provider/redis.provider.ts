import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * One shared ioredis connection for the whole app.
 *
 * Config, in order of preference:
 *   REDIS_URL                                  (what Railway gives you)
 *   REDIS_HOST / REDIS_PORT / REDIS_PASSWORD   (local docker-compose)
 */
export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('Redis');

    const options = {
      // Railway's private network (*.railway.internal) resolves over IPv6;
      // family 0 lets ioredis try both instead of failing with ENOTFOUND.
      family: 0,
      // GPS pings are frequent and disposable: fail fast instead of
      // letting requests pile up while Redis is down.
      maxRetriesPerRequest: 2,
    };

    const url = config.get<string>('REDIS_URL');
    const redis = url
      ? new Redis(url, options)
      : new Redis({
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: Number(config.get<string>('REDIS_PORT') ?? 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          ...options,
        });

    redis.on('connect', () => logger.log('Connected'));
    redis.on('error', (err: Error) =>
      logger.error(`Redis error: ${err.message}`),
    );
    return redis;
  },
};
