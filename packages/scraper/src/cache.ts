import { priceStatsSchema, type PriceStats } from '@margeo/shared';
import type { ScraperDriver } from './driver.js';

/** Stats de prix par (catégorie, marque, taille) mises en cache 6 h. */
export const PRICE_STATS_TTL_SECONDS = 6 * 60 * 60;

/** Sous-ensemble de l'API ioredis utilisé : facilite les tests et le remplacement du client. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

const segment = (v: string | null): string =>
  v === null || v.trim() === '' ? '_' : encodeURIComponent(v.trim().toLowerCase());

/**
 * Clé `stats:{categorie}:{marque}:{taille}`, insensible à la casse.
 * Chaque segment est encodé (un « : » dans une catégorie ne peut pas casser la clé) ;
 * un champ absent vaut « _ ».
 */
export function priceStatsCacheKey(
  categorie: string,
  marque: string | null,
  taille: string | null,
): string {
  return `stats:${segment(categorie)}:${segment(marque)}:${segment(taille)}`;
}

export interface CacheOptions {
  ttlSeconds?: number;
  /** Appelé sur erreur Redis ou entrée corrompue ; le cache ne doit jamais casser une analyse. */
  onError?: (err: unknown, context: { key: string; operation: 'get' | 'set' | 'parse' }) => void;
}

/**
 * Décore un driver : `searchSoldPrices` passe par le cache, `fetchListing` reste direct
 * (une annonce doit toujours être lue fraîche).
 */
export function withPriceStatsCache(
  driver: ScraperDriver,
  store: CacheStore,
  opts: CacheOptions = {},
): ScraperDriver {
  const ttl = opts.ttlSeconds ?? PRICE_STATS_TTL_SECONDS;
  const report = opts.onError ?? (() => {});

  return {
    name: driver.name,
    fetchListing: (url) => driver.fetchListing(url),
    async searchSoldPrices(category, brand, size): Promise<PriceStats> {
      const key = priceStatsCacheKey(category, brand, size);

      let cached: string | null = null;
      try {
        cached = await store.get(key);
      } catch (err) {
        report(err, { key, operation: 'get' });
      }
      if (cached !== null) {
        try {
          return priceStatsSchema.parse(JSON.parse(cached));
        } catch (err) {
          report(err, { key, operation: 'parse' });
        }
      }

      const stats = await driver.searchSoldPrices(category, brand, size);
      try {
        await store.set(key, JSON.stringify(stats), 'EX', ttl);
      } catch (err) {
        report(err, { key, operation: 'set' });
      }
      return stats;
    },
  };
}
