import type { NormalizedListing, PriceStats } from '@margeo/shared';

export const SCRAPER_DRIVERS = ['apify', 'custom'] as const;
export type ScraperDriverName = (typeof SCRAPER_DRIVERS)[number];

/**
 * Contrat commun à tous les drivers de scraping. Le reste de l'application ne dépend
 * que de cette interface : le driver est choisi par la variable `SCRAPER_DRIVER`.
 */
export interface ScraperDriver {
  readonly name: ScraperDriverName;
  /** Récupère et normalise une annonce Vinted à partir de son URL. */
  fetchListing(url: string): Promise<NormalizedListing>;
  /** Collecte les ventes réelles observées pour (catégorie, marque, taille). */
  searchSoldPrices(
    category: string,
    brand: string | null,
    size: string | null,
  ): Promise<PriceStats>;
}
