import { SCORE } from './constants/defaults.js';
import type { Cents } from './money.js';
import type { Confidence } from './schemas.js';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Vitesse de vente normalisée entre 0 et 1, à partir de la médiane du délai de vente.
 *  - ≤ 3 jours → 1 (part très vite)
 *  - ≥ 30 jours → 0 (dort en stock)
 *  - interpolation linéaire entre les deux.
 * Sans donnée de délai, on prend la valeur neutre 0,5 et la confiance passe à « low ».
 */
export function computeVitesse(medianJoursVente: number | null): {
  vitesse: number;
  confidence: Confidence;
} {
  if (medianJoursVente === null || !Number.isFinite(medianJoursVente)) {
    return { vitesse: SCORE.vitesseParDefaut, confidence: 'low' };
  }
  const { joursVenteRapide, joursVenteLente } = SCORE;
  const vitesse = clamp(
    (joursVenteLente - medianJoursVente) / (joursVenteLente - joursVenteRapide),
    0,
    1,
  );
  return { vitesse, confidence: 'high' };
}

/** Plancher du dénominateur (1 €) : évite qu'un article à quelques centimes fasse exploser le ratio. */
export const SCORE_DENOMINATEUR_MIN_CENTS = 100;

/**
 * Score « bonne affaire » 0–100.
 *
 *   ratioBrut = margeNette / max(prixReventeEstime, 1 €)
 *   score     = 100 × (0,7 × clamp(ratioBrut, 0, 1) + 0,3 × vitesse)
 *
 * Le ratio part de la marge NETTE (après frais, port, emballage, cotisations et temps) :
 * une annonce très bradée mais plombée par les frais obtient un mauvais score, pas un bon.
 */
export function computeScore(
  margeNetteCents: Cents,
  prixReventeEstimeCents: Cents,
  vitesse: number,
): number {
  const ratioBrut =
    margeNetteCents / Math.max(prixReventeEstimeCents, SCORE_DENOMINATEUR_MIN_CENTS);
  const raw =
    100 * (SCORE.poidsMarge * clamp(ratioBrut, 0, 1) + SCORE.poidsVitesse * clamp(vitesse, 0, 1));
  return clamp(Math.round(raw), 0, 100);
}
