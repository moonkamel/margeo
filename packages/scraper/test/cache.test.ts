import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import type { PriceStats } from '@margeo/shared';
import {
  PRICE_STATS_TTL_SECONDS,
  priceStatsCacheKey,
  withPriceStatsCache,
  type CacheStore,
  type ScraperDriver,
} from '../src/index.js';

const STATS: PriceStats = {
  categorie: 'Baskets',
  marque: 'Nike',
  taille: '42',
  ventes: [
    {
      prixVenteCents: 4500,
      etat: 'BON',
      categorie: 'Baskets',
      marque: 'Nike',
      taille: '42',
      soldAt: new Date('2026-11-01T10:00:00Z'),
      listedAt: null,
      source: 'sold_status',
    },
  ],
  nbVentes: 1,
  medianeCents: 4500,
  minCents: 4500,
  maxCents: 4500,
  collecteAt: new Date('2026-11-02T12:00:00Z'),
};

function fakeDriver() {
  const searchSoldPrices = vi.fn(async () => STATS);
  const driver: ScraperDriver = {
    name: 'apify',
    fetchListing: vi.fn(async () => {
      throw new Error('non utilisé');
    }),
    searchSoldPrices,
  };
  return { driver, searchSoldPrices };
}

describe('priceStatsCacheKey', () => {
  it('format stats:{categorie}:{marque}:{taille}, insensible à la casse', () => {
    expect(priceStatsCacheKey('Baskets', 'Nike', '42')).toBe('stats:baskets:nike:42');
    expect(priceStatsCacheKey(' BASKETS ', 'nike', '42')).toBe('stats:baskets:nike:42');
  });
  it('champs absents → « _ », segments encodés', () => {
    expect(priceStatsCacheKey('Jeans', null, null)).toBe('stats:jeans:_:_');
    expect(priceStatsCacheKey('a:b', "Levi's", 'W32 | FR 42')).toBe(
      "stats:a%3Ab:levi's:w32%20%7C%20fr%2042",
    );
  });
});

describe('withPriceStatsCache — résilience (store en mémoire)', () => {
  it('Redis en panne → on interroge le driver, l’erreur est signalée, pas propagée', async () => {
    const { driver, searchSoldPrices } = fakeDriver();
    const broken: CacheStore = {
      get: async () => {
        throw new Error('ECONNREFUSED');
      },
      set: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const onError = vi.fn();
    const cached = withPriceStatsCache(driver, broken, { onError });
    await expect(cached.searchSoldPrices('Baskets', 'Nike', '42')).resolves.toEqual(STATS);
    expect(searchSoldPrices).toHaveBeenCalledOnce();
    expect(onError.mock.calls.map((c) => c[1].operation)).toEqual(['get', 'set']);
  });

  it('fetchListing n’est jamais mis en cache', async () => {
    const { driver } = fakeDriver();
    const store: CacheStore = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') };
    await expect(withPriceStatsCache(driver, store).fetchListing('x')).rejects.toThrow();
    expect(store.get).not.toHaveBeenCalled();
  });
});

/**
 * Tests d'intégration contre un vrai Redis (`docker compose up`, REDIS_URL).
 * Ignorés si REDIS_URL n'est pas défini ; la CI fournit un service Redis.
 */
const REDIS_URL = process.env['REDIS_URL'];
describe.skipIf(!REDIS_URL)('withPriceStatsCache — Redis réel', () => {
  let redis: Redis;
  const prefix = `test-${process.pid}`;
  const store: CacheStore = {
    get: (k) => redis.get(`${prefix}:${k}`),
    set: (k, v, mode, ttl) => redis.set(`${prefix}:${k}`, v, mode, ttl),
  };

  beforeAll(() => {
    redis = new Redis(REDIS_URL ?? '', { maxRetriesPerRequest: 1 });
  });
  beforeEach(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('miss puis hit : le driver n’est appelé qu’une fois, dates restaurées', async () => {
    const { driver, searchSoldPrices } = fakeDriver();
    const cached = withPriceStatsCache(driver, store);
    const first = await cached.searchSoldPrices('Baskets', 'Nike', '42');
    const second = await cached.searchSoldPrices('BASKETS', 'nike', '42');
    expect(searchSoldPrices).toHaveBeenCalledOnce();
    expect(second).toEqual(first);
    expect(second.collecteAt).toBeInstanceOf(Date);
    expect(second.ventes[0]?.soldAt).toBeInstanceOf(Date);
  });

  it('TTL de 6 h posé sur la clé attendue', async () => {
    const { driver } = fakeDriver();
    await withPriceStatsCache(driver, store).searchSoldPrices('Baskets', 'Nike', '42');
    const ttl = await redis.ttl(`${prefix}:stats:baskets:nike:42`);
    expect(ttl).toBeGreaterThan(PRICE_STATS_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(PRICE_STATS_TTL_SECONDS);
  });

  it('entrée corrompue → recalcul et réécriture', async () => {
    await redis.set(`${prefix}:stats:baskets:nike:42`, '{pas du json', 'EX', 60);
    const { driver, searchSoldPrices } = fakeDriver();
    const onError = vi.fn();
    await expect(
      withPriceStatsCache(driver, store, { onError }).searchSoldPrices('Baskets', 'Nike', '42'),
    ).resolves.toEqual(STATS);
    expect(searchSoldPrices).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'parse' }),
    );
    expect(JSON.parse((await redis.get(`${prefix}:stats:baskets:nike:42`)) ?? '{}').nbVentes).toBe(
      1,
    );
  });

  it('cellules différentes → clés différentes', async () => {
    const { driver, searchSoldPrices } = fakeDriver();
    const cached = withPriceStatsCache(driver, store);
    await cached.searchSoldPrices('Baskets', 'Nike', '42');
    await cached.searchSoldPrices('Baskets', 'Nike', '43');
    await cached.searchSoldPrices('Baskets', null, null);
    expect(searchSoldPrices).toHaveBeenCalledTimes(3);
  });
});
