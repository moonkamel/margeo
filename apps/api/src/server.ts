import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes, type HealthCheck } from './routes/health.js';

export interface ServerDeps {
  healthChecks: Record<string, HealthCheck>;
}

export interface BuildServerOptions {
  logger?: FastifyServerOptions['logger'];
}

/** Construit l'application Fastify. Les dépendances sont injectées (testabilité). */
export async function buildServer(
  deps: ServerDeps,
  opts: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    // Corrélation des logs structurés : un identifiant par requête.
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  // Renvoie l'identifiant de requête au client pour faciliter le support.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Réponse d'erreur générique : jamais de message technique brut côté client.
  app.setErrorHandler((err, request, reply) => {
    const raw =
      typeof err === 'object' && err !== null && 'statusCode' in err ? err.statusCode : undefined;
    const statusCode = typeof raw === 'number' && raw >= 400 && raw < 600 ? raw : 500;
    if (statusCode >= 500) request.log.error({ err }, 'erreur non gérée');
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'bad_request',
      message:
        statusCode >= 500
          ? 'Une erreur inattendue est survenue. Réessayez dans quelques instants.'
          : 'La requête est invalide.',
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ error: 'not_found', message: 'Ressource introuvable.', requestId: request.id }),
  );

  await app.register(healthRoutes, { checks: deps.healthChecks });
  return app;
}
