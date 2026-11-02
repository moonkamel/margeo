import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadEnv } from '../src/env.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ok = async (): Promise<void> => {};
const ko = async (): Promise<void> => {
  throw new Error('ECONNREFUSED 127.0.0.1:5432');
};

describe('GET /health', () => {
  it('200 quand toutes les dépendances répondent', async () => {
    app = await buildServer({ healthChecks: { postgres: ok, redis: ok } }, { logger: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('503 si une dépendance échoue, sans fuite du message technique', async () => {
    app = await buildServer({ healthChecks: { postgres: ko, redis: ok } }, { logger: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', checks: { postgres: 'error', redis: 'ok' } });
    expect(res.body).not.toContain('ECONNREFUSED');
  });

  it('503 si une dépendance ne répond pas à temps', async () => {
    const hang = () => new Promise<void>(() => {});
    app = await buildServer({ healthChecks: { redis: hang } }, { logger: false });
    // Le timeout par défaut (2 s) suffit à garder le test court.
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
  }, 5000);

  it('propage un x-request-id fourni par le client', async () => {
    app = await buildServer({ healthChecks: {} }, { logger: false });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-42' },
    });
    expect(res.headers['x-request-id']).toBe('req-42');
  });
});

describe('erreurs', () => {
  it('404 en français, format stable', async () => {
    app = await buildServer({ healthChecks: {} }, { logger: false });
    const res = await app.inject({ method: 'GET', url: '/inconnu' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found', message: 'Ressource introuvable.' });
  });

  it('500 générique sans détail technique', async () => {
    app = await buildServer({ healthChecks: {} }, { logger: false });
    app.get('/boom', async () => {
      throw new Error('stack trace secrète');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secrète');
    expect(res.json().error).toBe('internal_error');
  });
});

describe('loadEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('échoue tôt en nommant les variables manquantes', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL.*REDIS_URL/);
  });
});
