import type { ApifyDriver } from '../drivers/apify.js';
import { isClosedPayload, isSoldPayload } from '../detection.js';
import { normalizeVintedItem } from '../normalize.js';
import { buildCellSearchUrl, parseVintedItemUrl } from '../url.js';
import type { Cellule, DiscoveredListing, RecheckResult, SeedSource } from './types.js';

type ApifyLike = Pick<ApifyDriver, 'fetchListingsRaw' | 'searchRawUrl'>;

/** Sous-catégorie (catalogue feuille) d'un item brut, ou null si absente. */
export function subcategoryIdOf(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const nested = r['catalog'];
  const v =
    r['catalog_id'] ??
    r['catalogId'] ??
    (typeof nested === 'object' && nested !== null
      ? (nested as Record<string, unknown>)['id']
      : undefined);
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

const idOf = (raw: unknown): string | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const v = r['id'] ?? r['item_id'] ?? r['itemId'];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
};

/**
 * Adaptateur Apify → SeedSource.
 * Facturation déclarée = nombre d'items renvoyés par l'acteur (l'entrée plafonne `maxItems`).
 */
export class ApifySeedSource implements SeedSource {
  constructor(
    private readonly driver: ApifyLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recheck(urls: readonly string[]) {
    const items = await this.driver.fetchListingsRaw(urls);
    const parId = new Map<string, unknown>();
    for (const raw of items) {
      const id = idOf(raw);
      if (id !== null) parId.set(id, raw);
    }
    const now = this.now();
    const results: RecheckResult[] = urls.map((url) => {
      const raw = parId.get(parVintedId(url));
      // Absente du dataset (ou réponse « introuvable » sans identifiant) → introuvable.
      if (raw === undefined) return { url, outcome: 'not_found' };
      const n = normalizeVintedItem(raw, now);
      if (!n.ok) {
        return n.reason === 'deleted'
          ? { url, outcome: 'not_found' }
          : { url, outcome: 'illisible', detail: n.detail };
      }
      const outcome = isSoldPayload(raw) ? 'sold' : isClosedPayload(raw) ? 'closed' : 'active';
      return { url, outcome, listing: n.listing, payload: raw };
    });
    return { results, resultatsFactures: items.length };
  }

  async discover(cellule: Cellule, maxItems: number) {
    const items = await this.driver.searchRawUrl(
      buildCellSearchUrl(cellule.catalogId, cellule.marque, cellule.taille),
      maxItems,
    );
    const now = this.now();
    const listings: DiscoveredListing[] = [];
    for (const raw of items) {
      const n = normalizeVintedItem(raw, now);
      if (n.ok)
        listings.push({ listing: n.listing, payload: raw, subcategoryId: subcategoryIdOf(raw) });
    }
    return { listings, resultatsFactures: items.length };
  }
}

function parVintedId(url: string): string {
  return parseVintedItemUrl(url).externalId;
}
