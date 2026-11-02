import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NormalizedListing, PriceStats } from '@margeo/shared';
import type { ScraperDriver } from '../driver.js';
import { ScraperError } from '../errors.js';
import { normalizeVintedItem } from '../normalize.js';
import { computePriceStats } from '../stats.js';
import { parseVintedItemUrl } from '../url.js';

/**
 * Driver HORS-LIGNE pour le CLI de debug, utilisé quand aucun token Apify n'est configuré.
 * Il ne touche jamais le réseau : il renvoie une annonce de démonstration issue des fixtures
 * (clairement signalée comme telle) et AUCUNE vente — on n'invente pas de données de marché.
 * Non sélectionnable via SCRAPER_DRIVER et non exporté par le paquet.
 */
export class FixtureDriver implements ScraperDriver {
  readonly name = 'apify' as const;
  readonly offline = true;

  constructor(
    private readonly fixturePath = fileURLToPath(
      new URL('../../fixtures/sample-listing.json', import.meta.url),
    ),
  ) {}

  async fetchListing(url: string): Promise<NormalizedListing> {
    parseVintedItemUrl(url); // même validation d'URL que le vrai driver
    const r = normalizeVintedItem(JSON.parse(readFileSync(this.fixturePath, 'utf8')));
    if (!r.ok) throw new ScraperError('normalization_failed', `Fixture invalide : ${r.detail}`);
    return r.listing;
  }

  async searchSoldPrices(
    category: string,
    brand: string | null,
    size: string | null,
  ): Promise<PriceStats> {
    return computePriceStats({ categorie: category, marque: brand, taille: size }, [], new Date());
  }
}
