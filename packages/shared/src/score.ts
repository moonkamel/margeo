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

/**
 * Score « bonne affaire » 0–100.
 * score = 100 × (0,7 × clamp((revente − achat) / revente, 0, 1) + 0,3 × vitesse)
 * Le ratio mesure la décote brute par rapport au marché (avant frais) : il est
 * volontairement indépendant des préférences pour rester comparable entre utilisateurs.
 */
export function computeScore(
  prixReventeEstimeCents: Cents,
  prixAchatCents: Cents,
  vitesse: number,
): number {
  const ratio =
    prixReventeEstimeCents > 0
      ? clamp((prixReventeEstimeCents - prixAchatCents) / prixReventeEstimeCents, 0, 1)
      : 0;
  const raw = 100 * (SCORE.poidsMarge * ratio + SCORE.poidsVitesse * clamp(vitesse, 0, 1));
  return clamp(Math.round(raw), 0, 100);
}
