import { ESTIMATION, MULTIPLICATEURS_ETAT_REPLI } from './constants/defaults.js';
import { roundCents, type Cents } from './money.js';
import type { Etat, NiveauEstimation, PriceEstimate, SoldSale } from './schemas.js';

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

export interface EstimationTarget {
  categorie: string;
  marque: string | null;
  taille: string | null;
  etat: Etat;
}

export type EstimationOutcome =
  | { status: 'ok'; estimate: PriceEstimate }
  | { status: 'insufficient_data'; nbVentesTrouvees: number; minVentesRequis: number };

/** Médiane d'une liste de nombres (moyenne des deux valeurs centrales si effectif pair). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('Médiane d’une liste vide');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const norm = (s: string | null): string | null => (s === null ? null : s.trim().toLowerCase());

interface Niveau {
  niveau: NiveauEstimation;
  match: (s: SoldSale) => boolean;
}

/**
 * Niveaux de repli hiérarchique, du plus précis au plus large.
 * Un niveau qui exige un champ absent de l'annonce cible (marque ou taille null) est ignoré :
 * on ne compare jamais « null » à « null », ce qui mélangerait des articles sans rapport.
 */
function niveaux(target: EstimationTarget): Niveau[] {
  const cat = norm(target.categorie);
  const marque = norm(target.marque);
  const taille = norm(target.taille);
  const result: Niveau[] = [];
  if (marque !== null && taille !== null) {
    result.push({
      niveau: 'categorie_marque_taille',
      match: (s) =>
        norm(s.categorie) === cat && norm(s.marque) === marque && norm(s.taille) === taille,
    });
  }
  if (marque !== null) {
    result.push({
      niveau: 'categorie_marque',
      match: (s) => norm(s.categorie) === cat && norm(s.marque) === marque,
    });
  }
  result.push({ niveau: 'categorie', match: (s) => norm(s.categorie) === cat });
  return result;
}

/** Médiane du délai de vente (jours) sur les ventes de la cellule dont la date de mise en ligne est connue. */
function medianJoursVente(cell: readonly SoldSale[]): number | null {
  const delais = cell
    .filter((s): s is SoldSale & { listedAt: Date } => s.listedAt !== null)
    .map((s) => (s.soldAt.getTime() - s.listedAt.getTime()) / MS_PAR_JOUR)
    .filter((d) => d >= 0);
  if (delais.length < ESTIMATION.minVentes) return null;
  return Math.round(median(delais) * 10) / 10;
}

/**
 * Estime le prix de revente à partir des ventes RÉELLES uniquement (règle « aucun prix inventé »).
 *
 * 1. Fenêtre glissante de 30 jours.
 * 2. Repli hiérarchique (catégorie, marque, taille) → (catégorie, marque) → (catégorie) :
 *    on retient le premier niveau qui compte au moins 5 ventes `sold_status`.
 * 3. Dans ce niveau :
 *    - si au moins 5 ventes dans le même état → médiane empirique de l'état (`empirical`) ;
 *    - sinon → chaque vente est ramenée en équivalent « très bon état » (prix / multiplicateur
 *      de son état), on prend la médiane, puis on applique le multiplicateur de l'état visé
 *      (`fallback`). Le résultat reste ancré sur des prix réels ; seul l'ajustement d'état
 *      est une hypothèse, signalée comme telle.
 * 4. Aucun niveau suffisant → `insufficient_data` : on n'estime pas.
 */
export function estimateResalePrice(
  ventes: readonly SoldSale[],
  target: EstimationTarget,
  now: Date,
): EstimationOutcome {
  const debutFenetre = now.getTime() - ESTIMATION.fenetreJours * MS_PAR_JOUR;
  const dansFenetre = ventes.filter((s) => {
    const t = s.soldAt.getTime();
    return t >= debutFenetre && t <= now.getTime();
  });
  const ventesPrix = dansFenetre.filter((s) => s.source === 'sold_status');

  let nbVentesTrouvees = 0;
  for (const { niveau, match } of niveaux(target)) {
    const cell = ventesPrix.filter(match);
    nbVentesTrouvees = cell.length;
    if (cell.length < ESTIMATION.minVentes) continue;

    const prix = cell.map((s) => s.prixVenteCents);
    const memeEtat = cell.filter((s) => s.etat === target.etat);

    let medianeCents: Cents;
    let prixReventeEstimeCents: Cents;
    let source: PriceEstimate['source'];
    let multiplicateurEtat: number;

    if (memeEtat.length >= ESTIMATION.minVentes) {
      medianeCents = roundCents(median(memeEtat.map((s) => s.prixVenteCents)));
      prixReventeEstimeCents = medianeCents;
      source = 'empirical';
      multiplicateurEtat = 1;
    } else {
      const equivalentsTresBon = cell.map(
        (s) => s.prixVenteCents / MULTIPLICATEURS_ETAT_REPLI[s.etat],
      );
      medianeCents = roundCents(median(equivalentsTresBon));
      multiplicateurEtat = MULTIPLICATEURS_ETAT_REPLI[target.etat];
      prixReventeEstimeCents = roundCents(medianeCents * multiplicateurEtat);
      source = 'fallback';
    }

    // La vitesse inclut les disparitions (signal faible), sur le même niveau.
    const cellVitesse = dansFenetre.filter(match);

    return {
      status: 'ok',
      estimate: {
        prixReventeEstimeCents,
        medianeCents,
        nbVentes: cell.length,
        niveau,
        source,
        multiplicateurEtat,
        fenetreJours: ESTIMATION.fenetreJours,
        minCents: Math.min(...prix),
        maxCents: Math.max(...prix),
        medianJoursVente: medianJoursVente(cellVitesse),
      },
    };
  }

  return { status: 'insufficient_data', nbVentesTrouvees, minVentesRequis: ESTIMATION.minVentes };
}
