import type { FastifyPluginAsync } from 'fastify';

export type HealthCheck = () => Promise<void>;

export interface HealthRouteOptions {
  checks: Record<string, HealthCheck>;
  /** Délai max par dépendance, en ms. */
  timeoutMs?: number;
}

type CheckStatus = 'ok' | 'error';

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout après ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET /health — vérifie chaque dépendance (Postgres, Redis) en parallèle.
 * 200 si tout répond, 503 sinon. Le détail technique de l'erreur part dans les logs,
 * jamais dans la réponse.
 */
export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, opts) => {
  const timeoutMs = opts.timeoutMs ?? 2000;

  app.get('/health', async (request, reply) => {
    const entries = await Promise.all(
      Object.entries(opts.checks).map(async ([name, check]): Promise<[string, CheckStatus]> => {
        try {
          await withTimeout(check(), timeoutMs);
          return [name, 'ok'];
        } catch (err) {
          request.log.error({ err, dependency: name }, 'health check en échec');
          return [name, 'error'];
        }
      }),
    );
    const checks = Object.fromEntries(entries);
    const healthy = entries.every(([, s]) => s === 'ok');
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
  });
};
