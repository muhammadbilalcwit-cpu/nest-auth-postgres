import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const createRedisClient = (configService: ConfigService, name: string) => {
  const redis = new Redis({
    host: configService.get('REDIS_HOST', 'localhost'),
    port: configService.get('REDIS_PORT', 6379),
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redis.on('connect', () => {
    console.log(`Redis ${name} client connected successfully`);
  });

  redis.on('error', (err) => {
    console.error(`Redis ${name} client error:`, err);
  });

  return redis;
};

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        return createRedisClient(configService, 'main');
      },
      inject: [ConfigService],
    },
    // Pub client for Socket.io Redis adapter
    {
      provide: 'REDIS_PUB_CLIENT',
      useFactory: (configService: ConfigService) => {
        return createRedisClient(configService, 'pub');
      },
      inject: [ConfigService],
    },
    // Sub client for Socket.io Redis adapter
    {
      provide: 'REDIS_SUB_CLIENT',
      useFactory: (configService: ConfigService) => {
        return createRedisClient(configService, 'sub');
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT', 'REDIS_PUB_CLIENT', 'REDIS_SUB_CLIENT'],
})
export class RedisModule {}
