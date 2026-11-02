import type { NormalizedListing } from '@margeo/shared';
import { isDisappeared, type ObservationPoint } from '../detection.js';
import { sanitizeListingPayload } from '../sanitize.js';
import type {
  Cellule,
  NewTracked,
  ObservationInput,
  RecheckResult,
  SoldProjection,
  TrackedState,
} from './types.js';

/**
 * Transitions d'état d'une annonce suivie — logique PURE.
 * L'orchestrateur applique le résultat (patch + observation + projection) dans une transaction.
 */

export type Evenement = 'vue' | 'vendue' | 'disparue' | 'cloturee' | 'echec' | 'illisible';

export interface Transition {
  evenement: Evenement;
  patch: Partial<NewTracked>;
  observation: Omit<ObservationInput, 'trackedListingId'> | null;
  vente: Omit<SoldProjection, 'trackedListingId'> | null;
}

const norm = (v: string | null): string | null => (v === null ? null : v.trim().toLowerCase());

/**
 * L'annonce suivie appartient-elle à la cellule ? Clé : catalogue de recherche + marque
 * canonique (+ taille si la cellule en fixe une). Le libellé de catégorie n'intervient JAMAIS.
 */
export function matchesCellule(
  t: Pick<TrackedState, 'catalogIdRecherche' | 'marque' | 'taille'>,
  c: Cellule,
): boolean {
  return (
    t.catalogIdRecherche === c.catalogId &&
    norm(t.marque) === norm(c.marque) &&
    (c.taille === null || norm(t.taille) === norm(c.taille))
  );
}

function snapshot(
  listing: NormalizedListing,
  payload: unknown,
  now: Date,
): Omit<ObservationInput, 'trackedListingId'> {
  return {
    titre: listing.titre,
    etat: listing.etat,
    prixCents: listing.prixCents,
    favoris: listing.favoris,
    vues: listing.vues,
    // Minimisation RGPD : seule une allowlist de champs est stockée (aucune donnée vendeur).
    payload: sanitizeListingPayload(payload),
    observedAt: now,
  };
}

/**
 * Annonce suivie créée par la découverte d'une cellule : marque canonique et libellé de la
 * cellule, catalogue de recherche, sous-catégorie réelle (libellé feuille du payload).
 */
export function newTrackedFrom(
  listing: NormalizedListing,
  cellule: Cellule,
  subcategoryId: number | null,
  now: Date,
): NewTracked {
  return {
    plateforme: 'VINTED',
    externalId: listing.externalId,
    url: listing.url,
    categorie: cellule.categorie,
    marque: cellule.marque,
    taille: listing.taille,
    prixInitialCents: listing.prixCents,
    prixCourantCents: listing.prixCents,
    etat: listing.etat,
    statut: 'ACTIVE',
    premiereVuAt: now,
    derniereVuAt: now,
    derniereVerifAt: now,
    echecsConsecutifs: 0,
    soldAt: null,
    soldPrixCents: null,
    soldSource: null,
    catalogIdRecherche: cellule.catalogId,
    subcategoryId,
    subcategoryLabel: subcategoryId === null ? null : listing.categorie,
  };
}

export function firstObservation(listing: NormalizedListing, payload: unknown, now: Date) {
  return snapshot(listing, payload, now);
}

export function transition(t: TrackedState, r: RecheckResult, now: Date): Transition {
  switch (r.outcome) {
    case 'illisible':
      return { evenement: 'illisible', patch: {}, observation: null, vente: null };

    case 'active':
      return {
        evenement: 'vue',
        patch: {
          prixCourantCents: r.listing.prixCents,
          etat: r.listing.etat,
          derniereVuAt: now,
          derniereVerifAt: now,
          echecsConsecutifs: 0,
        },
        observation: snapshot(r.listing, r.payload, now),
        vente: null,
      };

    case 'sold':
      return {
        evenement: 'vendue',
        patch: {
          statut: 'SOLD',
          prixCourantCents: r.listing.prixCents,
          etat: r.listing.etat,
          derniereVuAt: now,
          derniereVerifAt: now,
          echecsConsecutifs: 0,
          soldAt: now,
          soldPrixCents: r.listing.prixCents,
          soldSource: 'sold_status',
        },
        observation: snapshot(r.listing, r.payload, now),
        vente: {
          externalId: t.externalId,
          // Dernier prix affiché avant la vente (le prix négocié n'est pas public).
          prixVenteCents: r.listing.prixCents,
          etat: r.listing.etat,
          categorie: t.categorie,
          marque: t.marque,
          taille: t.taille,
          listedAt: t.premiereVuAt,
          soldAt: now,
          source: 'sold_status',
        },
      };

    case 'closed':
      return {
        evenement: 'cloturee',
        patch: { statut: 'CLOSED', derniereVuAt: now, derniereVerifAt: now, echecsConsecutifs: 0 },
        observation: snapshot(r.listing, r.payload, now),
        vente: null,
      };

    case 'not_found': {
      const echecs = t.echecsConsecutifs + 1;
      // Historique reconstitué : dernière vue active, échec précédent éventuel, échec actuel.
      const history: ObservationPoint[] = [{ observedAt: t.derniereVuAt, outcome: 'active' }];
      if (t.echecsConsecutifs > 0)
        history.push({ observedAt: t.derniereVerifAt, outcome: 'not_found' });
      history.push({ observedAt: now, outcome: 'not_found' });

      if (!isDisappeared(history)) {
        return {
          evenement: 'echec',
          patch: { echecsConsecutifs: echecs, derniereVerifAt: now },
          observation: null,
          vente: null,
        };
      }
      // Date de « vente » approchée : premier échec constaté.
      const soldAt = t.echecsConsecutifs > 0 ? t.derniereVerifAt : now;
      return {
        evenement: 'disparue',
        patch: {
          statut: 'DISAPPEARED',
          echecsConsecutifs: echecs,
          derniereVerifAt: now,
          soldAt,
          soldPrixCents: t.prixCourantCents,
          soldSource: 'disappeared',
        },
        observation: null,
        vente: {
          externalId: t.externalId,
          prixVenteCents: t.prixCourantCents,
          etat: t.etat,
          categorie: t.categorie,
          marque: t.marque,
          taille: t.taille,
          listedAt: t.premiereVuAt,
          soldAt,
          source: 'disappeared',
        },
      };
    }
  }
}
