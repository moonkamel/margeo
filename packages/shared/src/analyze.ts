import { ESTIMATION } from './constants/defaults.js';
import { classeColisPourCategorie } from './constants/vinted.js';
import { estimateResalePrice } from './estimate.js';
import { computeMargin } from './margin.js';
import type { AnalysisResult, Etat, Preferences, SoldSale } from './schemas.js';

export const MESSAGE_DONNEES_INSUFFISANTES = 'Données insuffisantes pour estimer une marge fiable';

export interface AnalyzeInput {
  listing: {
    prixCents: number;
    categorie: string;
    marque: string | null;
    taille: string | null;
    etat: Etat;
  };
  ventes: readonly SoldSale[];
  preferences: Preferences;
  now: Date;
}

/**
 * Pipeline pur : estimation du prix de revente puis calcul de marge.
 * Sans données de vente suffisantes, aucune marge n'est calculée.
 */
export function analyzeListing(input: AnalyzeInput): AnalysisResult {
  const { listing, ventes, preferences, now } = input;
  const outcome = estimateResalePrice(ventes, listing, now);

  if (outcome.status === 'insufficient_data') {
    return {
      status: 'insufficient_data',
      message: MESSAGE_DONNEES_INSUFFISANTES,
      nbVentesTrouvees: outcome.nbVentesTrouvees,
      minVentesRequis: ESTIMATION.minVentes,
    };
  }

  const margin = computeMargin({
    prixAchatCents: listing.prixCents,
    prixReventeEstimeCents: outcome.estimate.prixReventeEstimeCents,
    classeColis: classeColisPourCategorie(listing.categorie),
    preferences,
    medianJoursVente: outcome.estimate.medianJoursVente,
  });

  return { status: 'ok', estimate: outcome.estimate, margin };
}
