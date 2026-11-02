import type { NormalizedListing, PriceStats } from '@margeo/shared';
import type { ScraperDriver } from '../driver.js';
import { NotImplementedError } from '../errors.js';

export interface ApifyDriverConfig {
  actorId: string;
  token: string;
}

/**
 * Driver par défaut du MVP : délègue la collecte au scraper managé d'Apify.
 * Identifiant d'acteur et token viennent exclusivement de l'environnement
 * (`APIFY_ACTOR_ID`, `APIFY_TOKEN`) — jamais en dur.
 *
 * Phase 1 : stub qui fige l'interface. Implémentation réelle en Phase 2.
 */
export class ApifyDriver implements ScraperDriver {
  readonly name = 'apify' as const;

  constructor(private readonly config: ApifyDriverConfig) {}

  get actorId(): string {
    return this.config.actorId;
  }

  async fetchListing(_url: string): Promise<NormalizedListing> {
    throw new NotImplementedError('ApifyDriver.fetchListing (Phase 2)');
  }

  async searchSoldPrices(
    _category: string,
    _brand: string | null,
    _size: string | null,
  ): Promise<PriceStats> {
    throw new NotImplementedError('ApifyDriver.searchSoldPrices (Phase 2)');
  }
}
