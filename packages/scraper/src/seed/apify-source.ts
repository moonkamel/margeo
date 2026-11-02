import { adaptActorItem } from '../adapters/abotapi.js';
import type { ActorRunner, RunActeur } from '../drivers/apify-async.js';
import type { ApifyInputBuilders } from '../drivers/apify.js';
import { isClosedPayload, isSoldPayload } from '../detection.js';
import { ScraperError } from '../errors.js';
import { normalizeVintedItem } from '../normalize.js';
import { buildCellSearchUrl, parseVintedItemUrl } from '../url.js';
import { usdToMilli } from './budget.js';
import type {
  Cellule,
  DiscoveredListing,
  Facturation,
  PlafondAppel,
  RecheckResult,
  SeedSource,
} from './types.js';

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

function exigerPlafond(plafond: PlafondAppel | undefined): PlafondAppel {
  if (!plafond || !(plafond.maxTotalChargeUsd > 0))
    throw new ScraperError('invalid_response', 'Plafond de coût du run obligatoire');
  return plafond;
}

/** Facturation d'un run : résultats renvoyés, coût réel (si connu), run coupé ou non. */
function facturation(run: RunActeur): Facturation {
  return {
    resultatsFactures: run.items.length,
    ...(run.usageTotalUsd === null ? {} : { coutReelMilli: usdToMilli(run.usageTotalUsd) }),
    runCoupe: run.coupe,
  };
}

/**
 * Adaptateur Apify (runs asynchrones) → SeedSource. Chaque run reçoit ses plafonds de
 * plateforme : `maxItems` exact et `maxTotalChargeUsd` dérivé de la réservation de budget.
 */
export class ApifySeedSource implements SeedSource {
  constructor(
    private readonly runner: ActorRunner,
    private readonly inputs: ApifyInputBuilders,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recheck(urls: readonly string[], plafond?: PlafondAppel) {
    const { maxTotalChargeUsd } = exigerPlafond(plafond);
    if (urls.length === 0) return { results: [], resultatsFactures: 0 };
    const canonical = urls.map((u) => parseVintedItemUrl(u).canonicalUrl);
    const run = await this.runner.run(this.inputs.listings(canonical), {
      maxItems: urls.length,
      maxTotalChargeUsd,
    });
    const parId = new Map<string, unknown>();
    for (const raw of run.items) {
      const id = idOf(raw);
      if (id !== null) parId.set(id, raw);
    }
    const now = this.now();
    const results: RecheckResult[] = urls.map((url) => {
      const raw = parId.get(parseVintedItemUrl(url).externalId);
      if (raw === undefined) {
        // Run coupé : l'annonce n'a simplement pas été vérifiée — surtout pas « introuvable »,
        // ce qui la rapprocherait à tort d'une disparition (fausse vente).
        return run.coupe
          ? { url, outcome: 'illisible', detail: 'run coupé avant vérification' }
          : { url, outcome: 'not_found' };
      }
      const n = normalizeVintedItem(raw, now);
      if (!n.ok) {
        return n.reason === 'deleted'
          ? { url, outcome: 'not_found' }
          : { url, outcome: 'illisible', detail: n.detail };
      }
      // Détection sur la forme « API Vinted » (adaptateur abotapi le cas échéant).
      const vu = adaptActorItem(raw);
      const outcome = isSoldPayload(vu) ? 'sold' : isClosedPayload(vu) ? 'closed' : 'active';
      return { url, outcome, listing: n.listing, payload: raw };
    });
    return { results, ...facturation(run) };
  }

  async discover(cellule: Cellule, maxItems: number, plafond?: PlafondAppel) {
    const { maxTotalChargeUsd } = exigerPlafond(plafond);
    const run = await this.runner.run(
      this.inputs.search(
        buildCellSearchUrl(cellule.catalogId, cellule.marque, cellule.taille),
        maxItems,
      ),
      { maxItems, maxTotalChargeUsd },
    );
    const now = this.now();
    const listings: DiscoveredListing[] = [];
    for (const raw of run.items) {
      const n = normalizeVintedItem(raw, now);
      if (n.ok)
        listings.push({ listing: n.listing, payload: raw, subcategoryId: subcategoryIdOf(raw) });
    }
    return { listings, ...facturation(run) };
  }
}
