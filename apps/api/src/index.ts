import { createPrismaClient } from '@margeo/db';
import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { buildServer } from './server.js';

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

const app = await buildServer(
  {
    healthChecks: {
      postgres: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      redis: async () => {
        if (redis.status === 'wait') await redis.connect();
        await redis.ping();
      },
    },
  },
  {
    logger:
      env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: env.LOG_LEVEL },
  },
);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'arrêt en cours');
  await app.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: env.HOST });
