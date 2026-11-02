import type { Etat, NormalizedListing } from '@margeo/shared';

export type Tier = 'priority' | 'secondary' | 'tertiary';

/** Parc cible d'annonces actives par tier (doc 2b, section 8.1). */
export const CIBLE_PAR_TIER: Readonly<Record<Tier, number>> = {
  priority: 70,
  secondary: 30,
  tertiary: 20,
};

/**
 * Cellule de seed crawlable. Clé de rattachement : (catalogId, marque canonique, taille).
 * Le libellé `categorie` est cosmétique : il n'est jamais utilisé pour rattacher une annonce.
 */
export interface Cellule {
  /** Libellé Vinted (ex. « Sweats et pulls (H) »), affichage et stats uniquement. */
  categorie: string;
  /** Catalogue Vinted de la recherche (catégorie parente, ex. 13, 79) : source de vérité. */
  catalogId: number;
  /** Marque canonique (les alias validés s'y rattachent). */
  marque: string;
  /** null = toutes tailles (ex. tech). */
  taille: string | null;
  tier: Tier;
  /** Parc cible d'annonces actives suivies (= CIBLE_PAR_TIER[tier]). */
  cibleActives: number;
}

export type TrackedStatut = 'ACTIVE' | 'SOLD' | 'DISAPPEARED' | 'CLOSED';

/** Miroir applicatif d'une ligne TrackedListing. */
export interface TrackedState {
  id: string;
  plateforme: 'VINTED';
  externalId: string;
  url: string;
  categorie: string;
  marque: string | null;
  taille: string | null;
  prixInitialCents: number;
  prixCourantCents: number;
  etat: Etat;
  statut: TrackedStatut;
  premiereVuAt: Date;
  derniereVuAt: Date;
  derniereVerifAt: Date;
  echecsConsecutifs: number;
  soldAt: Date | null;
  soldPrixCents: number | null;
  soldSource: 'sold_status' | 'disappeared' | null;
  /** Catalogue parent de la recherche de découverte (null : annonce hors seed). Immuable. */
  catalogIdRecherche: number | null;
  /** Sous-catégorie Vinted relevée à la première observation. Immuable. */
  subcategoryId: number | null;
  subcategoryLabel: string | null;
}

export type NewTracked = Omit<TrackedState, 'id'>;

export interface ObservationInput {
  trackedListingId: string;
  titre: string;
  etat: Etat;
  prixCents: number;
  favoris: number;
  vues: number;
  payload: unknown;
  observedAt: Date;
}

export interface SoldProjection {
  trackedListingId: string;
  externalId: string;
  prixVenteCents: number;
  etat: Etat;
  categorie: string;
  marque: string | null;
  taille: string | null;
  listedAt: Date | null;
  soldAt: Date;
  source: 'sold_status' | 'disappeared';
}

/** Résultat de re-vérification d'une annonce suivie. */
export type RecheckResult =
  | {
      url: string;
      outcome: 'active' | 'sold' | 'closed';
      listing: NormalizedListing;
      payload: unknown;
    }
  | { url: string; outcome: 'not_found' }
  /** Payload reçu mais illisible : aucune transition d'état, compté comme erreur. */
  | { url: string; outcome: 'illisible'; detail: string };

export interface DiscoveredListing {
  listing: NormalizedListing;
  payload: unknown;
  /** Sous-catégorie (catalogue feuille) lue dans le payload ; null si absente. */
  subcategoryId: number | null;
}

export interface SubcategoryMapping {
  subcategoryId: number;
  parentId: number;
  libelle: string;
}

/**
 * Source de données du seed (port). Chaque appel déclare le nombre de résultats facturés.
 * Contrat : un appel ne facture jamais plus que `urls.length` / `maxItems` résultats.
 */
export interface SeedSource {
  recheck(
    urls: readonly string[],
  ): Promise<{ results: RecheckResult[]; resultatsFactures: number }>;
  discover(
    cellule: Cellule,
    maxItems: number,
  ): Promise<{ listings: DiscoveredListing[]; resultatsFactures: number }>;
}

export interface SeedTx {
  createTracked(t: NewTracked): Promise<TrackedState>;
  updateTracked(id: string, patch: Partial<NewTracked>): Promise<void>;
  appendObservation(o: ObservationInput): Promise<void>;
  writeSoldProjection(s: SoldProjection): Promise<void>;
  /** Enregistre sous-catégorie → parent si elle est inconnue (jamais d'écrasement). */
  recordSubcategory(m: SubcategoryMapping): Promise<void>;
}

export interface RunCounters {
  coutSuiviMilli: number;
  coutDecouverteMilli: number;
  resultatsFactures: number;
}

export type SeedRunStatut = 'COMPLETED' | 'PARTIAL' | 'BUDGET_STOPPED' | 'FAILED';

export interface SeedRunSummary {
  statut: SeedRunStatut;
  annoncesVerifiees: number;
  nouvellesAnnonces: number;
  ventesDetectees: number;
  disparitions: number;
  erreurs: number;
  details: Record<string, unknown>;
}

/** Persistance du seed (port). */
export interface SeedRepository {
  /** Lignes de la table BrandAlias (validées ou non). */
  loadBrandAliases(): Promise<{ alias: string; marque: string; valide: boolean }[]>;
  campaignSpent(campagne: string): Promise<{ suivi: number; decouverte: number }>;
  startRun(campagne: string, budgetMaxCents: number, startedAt: Date): Promise<string>;
  /** Incrémente la dépense du run immédiatement après chaque appel facturé. */
  recordSpend(
    runId: string,
    envelope: 'suivi' | 'decouverte',
    milli: number,
    resultatsFactures: number,
  ): Promise<void>;
  finishRun(runId: string, summary: SeedRunSummary, finishedAt: Date): Promise<void>;
  /**
   * Annonces ACTIVE du seed (catalogIdRecherche renseigné) à re-vérifier (dernière vérification
   * avant `before`), plus anciennes d'abord. Les annonces hors seed ne consomment pas le budget.
   */
  listToRecheck(before: Date, limit: number): Promise<TrackedState[]>;
  /** Annonces ACTIVE suivies dans la cellule : (catalogIdRecherche, marque, taille null = toutes). */
  countActive(cellule: Cellule): Promise<number>;
  /** Parent connu de chaque sous-catégorie demandée (absentes = jamais observées). */
  subcategoryParents(ids: readonly number[]): Promise<Map<number, number>>;
  /** Sous-ensemble des identifiants déjà suivis. */
  trackedExternalIds(externalIds: readonly string[]): Promise<Set<string>>;
  /** Exécute `fn` de façon atomique : en cas d'erreur, aucune écriture n'est conservée. */
  transaction<T>(fn: (tx: SeedTx) => Promise<T>): Promise<T>;
}
