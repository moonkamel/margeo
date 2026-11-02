import type { NormalizedListing, PriceStats, SoldSale } from '@margeo/shared';
import { toSoldSale } from '../detection.js';
import type { ScraperDriver } from '../driver.js';
import { ScraperError } from '../errors.js';
import { normalizeVintedItem } from '../normalize.js';
import { computePriceStats } from '../stats.js';
import { buildCatalogSearchUrl, parseVintedItemUrl } from '../url.js';

/**
 * Entrée envoyée à l'acteur. Chaque acteur Apify a son propre schéma d'entrée : ces builders
 * isolent cette dépendance. Les valeurs par défaut suivent la convention la plus répandue
 * (`startUrls` + `maxItems`) et devront être confirmées sur l'acteur retenu en Phase 2b.
 */
export interface ApifyInputBuilders {
  listing: (url: string) => unknown;
  /** Re-vérification en lot : plusieurs annonces dans un seul run (un seul coût de démarrage). */
  listings: (urls: readonly string[]) => unknown;
  search: (searchUrl: string, maxItems: number) => unknown;
}

export const DEFAULT_INPUT_BUILDERS: ApifyInputBuilders = {
  listing: (url) => ({ startUrls: [{ url }], maxItems: 1 }),
  listings: (urls) => ({ startUrls: urls.map((url) => ({ url })), maxItems: urls.length }),
  search: (searchUrl, maxItems) => ({ startUrls: [{ url: searchUrl }], maxItems }),
};

export interface ApifyDriverConfig {
  actorId: string;
  token: string;
  baseUrl?: string;
  /** Timeout du run côté Apify, en secondes (l'API synchrone plafonne à 300 s). */
  timeoutSecs?: number;
  /** Nombre de nouvelles tentatives sur 429 / 5xx / erreur réseau. */
  maxRetries?: number;
  /** Délai de base du backoff exponentiel, en ms. */
  backoffBaseMs?: number;
  maxSearchItems?: number;
  inputBuilders?: ApifyInputBuilders;
  /** Injectables pour les tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const SYNC_TIMEOUT_MAX_SECS = 300;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Driver par défaut du MVP : délègue la collecte à un acteur Apify, via l'endpoint synchrone
 * `POST /v2/acts/{actorId}/run-sync-get-dataset-items`, qui lance le run et renvoie
 * directement les éléments du dataset.
 *
 * Identifiant d'acteur et token viennent exclusivement de l'environnement
 * (`APIFY_ACTOR_ID`, `APIFY_TOKEN`). Le token passe dans l'en-tête Authorization,
 * jamais dans l'URL (qui finirait dans les logs).
 */
export class ApifyDriver implements ScraperDriver {
  readonly name = 'apify' as const;
  private readonly baseUrl: string;
  private readonly timeoutSecs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly maxSearchItems: number;
  private readonly inputs: ApifyInputBuilders;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly config: ApifyDriverConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.apify.com').replace(/\/+$/, '');
    this.timeoutSecs = Math.min(config.timeoutSecs ?? 60, SYNC_TIMEOUT_MAX_SECS);
    this.maxRetries = config.maxRetries ?? 2;
    this.backoffBaseMs = config.backoffBaseMs ?? 500;
    this.maxSearchItems = config.maxSearchItems ?? 200;
    this.inputs = config.inputBuilders ?? DEFAULT_INPUT_BUILDERS;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.sleep = config.sleep ?? defaultSleep;
    this.now = config.now ?? (() => new Date());
  }

  get actorId(): string {
    return this.config.actorId;
  }

  async fetchListing(url: string): Promise<NormalizedListing> {
    const { externalId, canonicalUrl } = parseVintedItemUrl(url);
    const items = await this.runActor(this.inputs.listing(canonicalUrl));
    const first = items[0];
    if (first === undefined) {
      throw new ScraperError('not_found', `Aucun résultat pour l'annonce ${externalId}`);
    }
    const result = normalizeVintedItem(first, this.now());
    if (!result.ok) {
      if (result.reason === 'deleted') {
        throw new ScraperError('not_found', `Annonce ${externalId} supprimée`);
      }
      throw new ScraperError('normalization_failed', `Annonce ${externalId} : ${result.detail}`);
    }
    if (result.listing.externalId !== externalId) {
      throw new ScraperError(
        'invalid_response',
        `L'acteur a renvoyé l'annonce ${result.listing.externalId} au lieu de ${externalId}`,
      );
    }
    return result.listing;
  }

  /**
   * Recherche catalogue normalisée. Les items illisibles sont ignorés (et comptés) plutôt que
   * de faire échouer toute la recherche : une annonce mal formée ne doit pas bloquer les autres.
   */
  async searchListings(
    category: string,
    brand: string | null,
    size: string | null,
  ): Promise<{ listings: NormalizedListing[]; ignores: number }> {
    const items = await this.searchRaw(category, brand, size, this.maxSearchItems);
    const now = this.now();
    const listings: NormalizedListing[] = [];
    let ignores = 0;
    for (const raw of items) {
      const r = normalizeVintedItem(raw, now);
      if (r.ok) listings.push(r.listing);
      else ignores++;
    }
    return { listings, ignores };
  }

  /** Recherche catalogue brute, plafonnée à `maxItems` résultats (plafond de facturation). */
  async searchRaw(
    category: string,
    brand: string | null,
    size: string | null,
    maxItems: number,
  ): Promise<unknown[]> {
    return this.searchRawUrl(buildCatalogSearchUrl(category, brand, size), maxItems);
  }

  /** Recherche brute sur une URL de catalogue déjà construite, plafonnée à `maxItems`. */
  async searchRawUrl(searchUrl: string, maxItems: number): Promise<unknown[]> {
    return this.runActor(this.inputs.search(searchUrl, maxItems));
  }

  /** Récupère plusieurs annonces en un seul run ; renvoie les items bruts (sans garantie d'ordre). */
  async fetchListingsRaw(urls: readonly string[]): Promise<unknown[]> {
    if (urls.length === 0) return [];
    const canonical = urls.map((u) => parseVintedItemUrl(u).canonicalUrl);
    return this.runActor(this.inputs.listings(canonical));
  }

  /**
   * Ventes réelles visibles dans une recherche : seules les annonces explicitement « sold ».
   * Limite connue : le catalogue Vinted expose peu d'annonces vendues ; la source principale
   * des statistiques sera le suivi des annonces dans le temps (crawler de seed, Phase 2b).
   */
  async searchSoldPrices(
    category: string,
    brand: string | null,
    size: string | null,
  ): Promise<PriceStats> {
    const { listings } = await this.searchListings(category, brand, size);
    const collecteAt = this.now();
    // La recherche catalogue est en texte libre : on ne garde que les annonces de la cellule
    // exacte demandée, pour ne jamais mélanger marques, tailles ou catégories dans les stats.
    const cell = (v: string | null) => (v === null ? null : v.trim().toLowerCase());
    const matches = (l: NormalizedListing) =>
      cell(l.categorie) === cell(category) &&
      (brand === null || cell(l.marque) === cell(brand)) &&
      (size === null || cell(l.taille) === cell(size));
    const ventes: SoldSale[] = listings
      .filter((l) => l.statut === 'sold' && matches(l))
      // Date de vente exacte inconnue dans un résultat de recherche : on retient la date de collecte.
      .map((l) => toSoldSale(l, { soldAt: collecteAt, listedAt: null, source: 'sold_status' }));
    return computePriceStats(
      { categorie: category, marque: brand, taille: size },
      ventes,
      collecteAt,
    );
  }

  private endpoint(): string {
    // Apify attend « user~actor » dans le chemin (le « / » est remplacé par « ~ »).
    const actor = encodeURIComponent(this.config.actorId.replace('/', '~'));
    const qs = new URLSearchParams({
      timeout: String(this.timeoutSecs),
      format: 'json',
      clean: 'true',
    });
    return `${this.baseUrl}/v2/acts/${actor}/run-sync-get-dataset-items?${qs.toString()}`;
  }

  /** Lance l'acteur avec backoff exponentiel sur les erreurs transitoires. */
  private async runActor(input: unknown): Promise<unknown[]> {
    let lastError: ScraperError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.runOnce(input);
      } catch (err) {
        const e =
          err instanceof ScraperError
            ? err
            : new ScraperError('upstream_unavailable', 'Erreur réseau', { cause: err });
        // Un run qui dépasse son timeout ne réussira pas mieux en le relançant aussitôt.
        if (!e.retryable || e.code === 'timeout' || attempt === this.maxRetries) throw e;
        lastError = e;
        const retryAfterMs = e.cause instanceof RetryAfter ? e.cause.ms : 0;
        await this.sleep(Math.max(retryAfterMs, this.backoffBaseMs * 2 ** attempt));
      }
    }
    throw lastError ?? new ScraperError('upstream_unavailable', 'Échec après nouvelles tentatives');
  }

  private async runOnce(input: unknown): Promise<unknown[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(input),
        // Marge au-delà du timeout du run, pour recevoir la réponse 408 d'Apify plutôt que couper avant.
        signal: AbortSignal.timeout((this.timeoutSecs + 15) * 1000),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new ScraperError('timeout', 'Délai dépassé côté client', { cause: err });
      }
      throw new ScraperError('upstream_unavailable', 'Erreur réseau vers Apify', { cause: err });
    }

    if (res.status === 408) throw new ScraperError('timeout', 'Run Apify hors délai (408)');
    if (res.status === 401 || res.status === 403) {
      throw new ScraperError('auth', `Authentification Apify refusée (${res.status})`);
    }
    if (res.status === 429) {
      throw new ScraperError('rate_limited', 'Limite de débit Apify (429)', {
        cause: new RetryAfter(parseRetryAfter(res.headers.get('retry-after'))),
      });
    }
    if (res.status >= 500)
      throw new ScraperError('upstream_unavailable', `Apify indisponible (${res.status})`);
    if (!res.ok)
      throw new ScraperError('upstream_error', `Réponse Apify inattendue (${res.status})`);

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new ScraperError('invalid_response', 'Réponse Apify non JSON', { cause: err });
    }
    if (!Array.isArray(body))
      throw new ScraperError('invalid_response', 'Le dataset Apify n’est pas un tableau');
    return body;
  }
}

/** Porte la durée Retry-After à travers `cause`, sans l'exposer dans l'API publique. */
class RetryAfter {
  constructor(readonly ms: number) {}
}

function parseRetryAfter(header: string | null): number {
  if (header === null) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 60_000) : 0;
}
