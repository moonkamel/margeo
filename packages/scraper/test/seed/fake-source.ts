import type { NormalizedListing } from '@margeo/shared';
import type {
  Cellule,
  DiscoveredListing,
  RecheckResult,
  SeedSource,
} from '../../src/seed/index.js';

/** Catalogue parent de test et sous-catégorie feuille par défaut. */
export const CATALOGUE_TEST = 100;
export const SOUS_CATEGORIE_TEST = 501;

export function cellule(categorie: string, marque: string, o: Partial<Cellule> = {}): Cellule {
  return {
    categorie,
    catalogId: CATALOGUE_TEST,
    marque,
    taille: null,
    tier: 'tertiary',
    cibleActives: 20,
    ...o,
  };
}

export function listing(
  overrides: Partial<NormalizedListing> & { externalId: string },
): NormalizedListing {
  return {
    plateforme: 'VINTED',
    url: `https://www.vinted.fr/items/${overrides.externalId}-x`,
    titre: `Annonce ${overrides.externalId}`,
    marque: 'Nike',
    categorie: 'Baskets',
    taille: '42',
    etat: 'TRES_BON',
    prixCents: 4000,
    favoris: 3,
    vues: 40,
    photos: [],
    description: '',
    vendeur: { pseudo: 'v', ancienneteJours: null, note: null, nbEvaluations: null },
    statut: 'active',
    ...overrides,
  };
}

/** Source factice pilotable : aucune requête réseau. */
export class FakeSource implements SeedSource {
  /** État « réel » des annonces, par URL. Absente = introuvable. */
  monde = new Map<string, NormalizedListing | 'closed' | 'illisible'>();
  /** Annonces renvoyées par la découverte, par cellule (clé catégorie|marque). */
  catalogue = new Map<string, NormalizedListing[]>();
  appels: { type: 'recheck' | 'discover'; taille: number }[] = [];
  failNext: Error | null = null;
  /** Sous-catégorie renvoyée par annonce (défaut SOUS_CATEGORIE_TEST ; null = absente). */
  sousCategorie = new Map<string, number | null>();
  /** Facturation simulée : par défaut, un résultat par item renvoyé. */
  surfacturation = 0;

  async recheck(urls: readonly string[]) {
    this.appels.push({ type: 'recheck', taille: urls.length });
    this.throwIfNeeded();
    const results: RecheckResult[] = [];
    let factures = 0;
    for (const url of urls) {
      const v = this.monde.get(url);
      if (v === undefined) {
        results.push({ url, outcome: 'not_found' });
        continue;
      }
      factures++;
      if (v === 'illisible') results.push({ url, outcome: 'illisible', detail: 'prix illisible' });
      else if (v === 'closed') {
        results.push({
          url,
          outcome: 'closed',
          listing: listing({ externalId: url.split('/').pop() ?? 'x' }),
          payload: {},
        });
      } else
        results.push({
          url,
          outcome: v.statut === 'sold' ? 'sold' : 'active',
          listing: v,
          payload: { raw: v.externalId },
        });
    }
    return { results, resultatsFactures: factures + this.surfacturation };
  }

  async discover(cellule: Cellule, maxItems: number) {
    this.appels.push({ type: 'discover', taille: maxItems });
    this.throwIfNeeded();
    const items = (this.catalogue.get(`${cellule.categorie}|${cellule.marque}`) ?? []).slice(
      0,
      maxItems,
    );
    const listings: DiscoveredListing[] = items.map((l) => ({
      listing: l,
      payload: { raw: l.externalId },
      subcategoryId: this.sousCategorie.has(l.externalId)
        ? (this.sousCategorie.get(l.externalId) ?? null)
        : SOUS_CATEGORIE_TEST,
    }));
    return { listings, resultatsFactures: items.length + this.surfacturation };
  }

  private throwIfNeeded() {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }
}
