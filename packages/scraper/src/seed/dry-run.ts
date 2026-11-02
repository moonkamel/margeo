import {
  budgetDepuisPlafond,
  formatMilli,
  MILLI_PAR_CENTIME,
  type BudgetConfig,
} from './budget.js';
import { motifsRefus, type CelluleConfig } from './config.js';
import type { BrandResolver } from './brand-alias.js';

/**
 * Plan d'un run de seed SANS appel Apify ni base (mode --dry-run, par défaut) :
 * cellules, lots, coût maximal estimé. Logique PURE, testée en mock.
 *
 * Hypothèse de coût maximal : parc de chaque cellule complet (cibleActives annonces
 * re-vérifiées par jour) et découverte au maximum quotidien sur chaque cellule.
 */
export interface SeedPlanOptions {
  plafondCents: number;
  /** Tarifs à simuler, en centimes pour 1 000 résultats (ex. [260, 357]). */
  tarifs: readonly number[];
  /** Frais fixes par run (démarrage de l'acteur), en milli. */
  coutParRunMilli: number;
  batchSize: number;
  maxDecouverteParCellule: number;
  joursParMois?: number;
}

export interface SeedPlanCellule {
  nom: string;
  catalogId: number | null;
  tier: string;
  cibleActives: number;
  decouverteMaxJour: number;
  refus: string[];
}

export interface SeedPlanTarif {
  coutPar1000Cents: number;
  budget: BudgetConfig;
  suiviJourMilli: number;
  decouverteJourMaxMilli: number;
  suiviMoisMilli: number;
  /** Jour du mois où l'arrêt dur serait atteint au rythme maximal (null : jamais). */
  jourArretDur: number | null;
  /** Jour où l'enveloppe découverte (cumulée) est épuisée au rythme maximal (null : jamais). */
  jourCoupureDecouverte: number | null;
  /** Dépense cumulée à 28 jours au rythme maximal (bornée par l'arrêt dur). */
  total4SemainesMilli: number;
}

export interface SeedPlan {
  cellules: SeedPlanCellule[];
  crawlables: number;
  /** Aucune cellule crawlable : volumes projetés sur toutes les cellules, à titre indicatif. */
  projectionHypothetique: boolean;
  suiviJour: number;
  lotsJour: number;
  /** Runs par jour au maximum (lots de suivi + une découverte par cellule). */
  runsJourMax: number;
  coutParRunMilli: number;
  decouverteJourMax: number;
  tarifs: SeedPlanTarif[];
}

export function planSeedRun(
  configs: readonly CelluleConfig[],
  opts: SeedPlanOptions,
  resolver?: BrandResolver,
): SeedPlan {
  const jours = opts.joursParMois ?? 30;
  const cellules = configs.map((c) => ({
    nom: `${c.categorie}|${c.marque}`,
    catalogId: c.catalogId,
    tier: c.tier,
    cibleActives: c.cibleActives,
    decouverteMaxJour: Math.min(opts.maxDecouverteParCellule, c.cibleActives),
    refus: motifsRefus(c, resolver),
  }));
  // Périmètre projeté : les cellules que --execute crawlerait réellement ; si aucune ne l'est
  // encore, projection hypothétique sur toutes les cellules du fichier.
  const crawlables = cellules.filter((c) => c.refus.length === 0);
  const perimetre = crawlables.length > 0 ? crawlables : cellules;
  const suiviJour = perimetre.reduce((a, c) => a + c.cibleActives, 0);
  const decouverteJourMax = perimetre.reduce((a, c) => a + c.decouverteMaxJour, 0);
  const lotsJour = Math.ceil(suiviJour / opts.batchSize);
  const tarifs = opts.tarifs.map((t) => {
    const budget = budgetDepuisPlafond(opts.plafondCents, t, opts.coutParRunMilli);
    // Frais fixes : un run par lot de re-vérification, un run de découverte par cellule.
    const suiviJourMilli = suiviJour * t + lotsJour * opts.coutParRunMilli;
    const decouverteJourMaxMilli = decouverteJourMax * t + perimetre.length * opts.coutParRunMilli;
    // Simulation jour par jour au rythme maximal : la découverte s'arrête quand SON enveloppe
    // CUMULÉE est épuisée (elle est coupée en premier) ; le suivi continue jusqu'à l'arrêt dur.
    const arret = budget.hardStopCents * MILLI_PAR_CENTIME;
    let resteDecouverte = budget.decouverteCents * MILLI_PAR_CENTIME;
    let cumul = 0;
    let jourArretDur: number | null = null;
    let jourCoupureDecouverte: number | null = null;
    let total4SemainesMilli: number | null = null;
    for (let jour = 1; jour <= Math.max(jours, 28); jour++) {
      const decouverte = Math.min(decouverteJourMaxMilli, resteDecouverte);
      resteDecouverte -= decouverte;
      if (decouverte < decouverteJourMaxMilli && jourCoupureDecouverte === null)
        jourCoupureDecouverte = jour;
      cumul = Math.min(arret, cumul + suiviJourMilli + decouverte);
      if (cumul >= arret && jourArretDur === null) jourArretDur = jour;
      if (jour === 28) total4SemainesMilli = cumul;
    }
    return {
      coutPar1000Cents: t,
      budget,
      suiviJourMilli,
      decouverteJourMaxMilli,
      suiviMoisMilli: suiviJourMilli * jours,
      jourArretDur: jourArretDur !== null && jourArretDur <= jours ? jourArretDur : null,
      jourCoupureDecouverte:
        jourCoupureDecouverte !== null && jourCoupureDecouverte <= jours
          ? jourCoupureDecouverte
          : null,
      total4SemainesMilli: total4SemainesMilli ?? cumul,
    };
  });
  return {
    cellules,
    crawlables: crawlables.length,
    projectionHypothetique: crawlables.length === 0,
    suiviJour,
    lotsJour,
    runsJourMax: lotsJour + perimetre.length,
    coutParRunMilli: opts.coutParRunMilli,
    decouverteJourMax,
    tarifs,
  };
}

const eur = (cents: number) => formatMilli(cents * MILLI_PAR_CENTIME);

export function formatSeedPlan(plan: SeedPlan, plafondCents: number, campagne: string): string {
  const l: string[] = [];
  l.push(`seed:run — DRY-RUN, aucune dépense, aucun appel Apify (campagne ${campagne})`);
  l.push('');
  l.push(
    `Cellules : ${plan.cellules.length} (${plan.crawlables} crawlables en --execute aujourd'hui)`,
  );
  for (const c of plan.cellules) {
    const statut = c.refus.length === 0 ? 'OK' : `REFUSÉE : ${c.refus.join(' ; ')}`;
    l.push(
      `  - ${c.nom} [catalogue ${c.catalogId ?? '?'}] ${c.tier}, cible ${c.cibleActives}, découverte ≤ ${c.decouverteMaxJour}/j — ${statut}`,
    );
  }
  l.push('');
  l.push(
    `Périmètre projeté : ${plan.projectionHypothetique ? `toutes les cellules (${plan.cellules.length}), hypothétique — aucune n'est crawlable` : `${plan.crawlables} cellule(s) crawlable(s) en --execute`}`,
  );
  l.push(
    `Volume maximal par jour (parcs complets) : ${plan.suiviJour} re-vérifications en ${plan.lotsJour} lots, + ${plan.decouverteJourMax} découvertes au plus`,
  );
  l.push(
    `Runs par jour : ${plan.runsJourMax} au plus × ${formatMilli(plan.coutParRunMilli)} de frais fixes = ${formatMilli(plan.runsJourMax * plan.coutParRunMilli)} par jour`,
  );
  for (const t of plan.tarifs) {
    const b = t.budget;
    l.push('');
    l.push(`Tarif ${eur(t.coutPar1000Cents)} / 1 000 résultats :`);
    l.push(
      `  Plafond ${eur(plafondCents)} → arrêt dur ${eur(b.hardStopCents)} (suivi ${eur(b.suiviCents)}, découverte ${eur(b.decouverteCents)})`,
    );
    l.push(
      `  Coût max par jour : suivi ${formatMilli(t.suiviJourMilli)} + découverte ${formatMilli(t.decouverteJourMaxMilli)}`,
    );
    l.push(`  Suivi sur 30 jours : ${formatMilli(t.suiviMoisMilli)}`);
    l.push(
      t.jourCoupureDecouverte === null
        ? '  Enveloppe découverte non épuisée sur 30 jours'
        : `  Enveloppe découverte (${eur(b.decouverteCents)}) épuisée vers le jour ${t.jourCoupureDecouverte} : découverte coupée, le suivi continue`,
    );
    l.push(`  Dépense cumulée à 4 semaines (28 j) : ${formatMilli(t.total4SemainesMilli)}`);
    l.push(
      t.jourArretDur === null
        ? '  Arrêt dur non atteint sur 30 jours au rythme maximal'
        : `  ⚠️ Arrêt dur atteint vers le jour ${t.jourArretDur} au rythme maximal`,
    );
  }
  l.push('');
  l.push('dry-run, aucune dépense');
  return l.join('\n');
}
