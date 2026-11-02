import type { NormalizedListing, SoldSale } from '@margeo/shared';

/**
 * Détection des ventes — logique PURE, sans réseau.
 *
 * Deux signaux, de fiabilité différente :
 *  1. Signal de payload (`isSoldPayload`) : l'annonce est explicitement marquée vendue.
 *     → seule source qui alimente la médiane de prix (`source: 'sold_status'`).
 *  2. Disparition (`isDisappeared`) : l'annonce, vue active, devient introuvable.
 *     Elle peut avoir été vendue… ou simplement supprimée par son vendeur.
 *     → signal faible, utilisé uniquement pour la vitesse de vente (`source: 'disappeared'`).
 */

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const lower = (v: unknown): string | null =>
  typeof v === 'string' ? v.trim().toLowerCase() : null;

/**
 * Vrai uniquement sur un signal EXPLICITE de vente.
 * `is_closed` seul ne suffit pas : une annonce peut être clôturée par suppression ou masquage.
 * `is_reserved` non plus : une réservation n'est pas une vente.
 */
export function isSoldPayload(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (lower(raw['item_closing_action']) === 'sold') return true;
  if (raw['is_sold'] === true || raw['isSold'] === true || raw['sold'] === true) return true;
  const statut = lower(raw['status']) ?? lower(raw['statut']) ?? lower(raw['state']);
  return statut === 'sold' || statut === 'vendu';
}

/**
 * Annonce clôturée SANS vente (supprimée, masquée par son vendeur) mais encore lisible.
 * Ce n'est ni une vente ni un signal de vitesse : on arrête simplement de la suivre.
 */
export function isClosedPayload(raw: unknown): boolean {
  if (!isRecord(raw) || isSoldPayload(raw)) return false;
  return raw['is_closed'] === true || raw['is_hidden'] === true;
}

/** Payload d'annonce supprimée ou introuvable (réponse d'erreur Vinted ou marqueur explicite). */
export function isDeletedPayload(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw['is_deleted'] === true || raw['deleted'] === true) return true;
  const statut = lower(raw['status']);
  if (statut === 'deleted' || statut === 'removed' || statut === 'not_found') return true;
  const code = lower(raw['message_code']);
  const message = lower(raw['message']);
  return (
    raw['id'] === undefined &&
    (code === 'not_found' || (message !== null && message.includes('not found')))
  );
}

export type ObservationOutcome = 'active' | 'sold' | 'not_found';

export interface ObservationPoint {
  observedAt: Date;
  outcome: ObservationOutcome;
}

export interface DisappearanceOptions {
  /** Nombre minimal d'échecs « introuvable » consécutifs (défaut 2). */
  minConsecutiveNotFound?: number;
  /** Écart minimal entre le premier et le dernier échec, pour ignorer les erreurs transitoires (défaut 12 h). */
  minSpanMs?: number;
}

/**
 * Une annonce est considérée « disparue » si :
 *  - elle a été vue active au moins une fois,
 *  - elle n'a jamais été vue vendue (sinon c'est une vente, pas une disparition),
 *  - les N dernières observations sont « introuvable », étalées sur au moins `minSpanMs`.
 */
export function isDisappeared(
  history: readonly ObservationPoint[],
  opts: DisappearanceOptions = {},
): boolean {
  const minConsecutive = opts.minConsecutiveNotFound ?? 2;
  const minSpanMs = opts.minSpanMs ?? 12 * 60 * 60 * 1000;
  const sorted = [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  if (sorted.some((p) => p.outcome === 'sold')) return false;

  let i = sorted.length - 1;
  while (i >= 0 && sorted[i]?.outcome === 'not_found') i--;
  const tail = sorted.slice(i + 1);
  const vueActive = sorted.slice(0, i + 1).some((p) => p.outcome === 'active');
  if (!vueActive || tail.length < minConsecutive) return false;

  const first = tail[0];
  const last = tail[tail.length - 1];
  if (!first || !last) return false;
  return last.observedAt.getTime() - first.observedAt.getTime() >= minSpanMs;
}

/**
 * Construit une vente observée à partir de la dernière annonce normalisée connue.
 * Le prix retenu est le dernier prix affiché (le prix réellement négocié n'est pas public).
 */
export function toSoldSale(
  listing: NormalizedListing,
  params: { soldAt: Date; listedAt: Date | null; source: SoldSale['source'] },
): SoldSale {
  return {
    prixVenteCents: listing.prixCents,
    etat: listing.etat,
    categorie: listing.categorie,
    marque: listing.marque,
    taille: listing.taille,
    soldAt: params.soldAt,
    listedAt: params.listedAt,
    source: params.source,
  };
}
