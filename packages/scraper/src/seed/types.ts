import type { Etat, NormalizedListing } from '@margeo/shared';

/** Cellule de seed : (catégorie Vinted exacte, marque normalisée, taille optionnelle). */
export interface Cellule {
  categorie: string;
  marque: string;
  /** null = toutes tailles (ex. tech). */
  taille: string | null;
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
  /** Annonces ACTIVE à re-vérifier (dernière vérification avant `before`), plus anciennes d'abord. */
  listToRecheck(before: Date, limit: number): Promise<TrackedState[]>;
  /** Nombre d'annonces ACTIVE suivies dans la cellule (taille null = toutes tailles). */
  countActive(cellule: Cellule): Promise<number>;
  /** Sous-ensemble des identifiants déjà suivis. */
  trackedExternalIds(externalIds: readonly string[]): Promise<Set<string>>;
  /** Exécute `fn` de façon atomique : en cas d'erreur, aucune écriture n'est conservée. */
  transaction<T>(fn: (tx: SeedTx) => Promise<T>): Promise<T>;
}
