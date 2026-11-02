/**
 * Vérification du volume des cellules (doc 2b, section 2 bis ; décisions du 2026-11-04).
 *
 * - Budget dédié, campagne séparée `verify-YYYY-MM` : plafond 12 €, arrêt dur 10 €.
 * - Mesure : `maxItems` résultats (250 par défaut) sur l'URL de catalogue exacte de la cellule ;
 *   atteindre le plafond signifie « au moins maxItems annonces ». Seules les annonces dont la
 *   marque se rattache à la cellule (alias validés) sont comptées.
 * - Étape 1 : 3 cellules pilotes ; étape 2 : les 12 autres, seulement si les pilotes passent.
 * - Arrêt : pilote sous le seuil, 0 résultat, ou budget de vérification atteint.
 */
import type { BrandResolver } from './brand-alias.js';
import { BudgetLedger, formatMilli, MILLI_PAR_CENTIME, type BudgetConfig } from './budget.js';
import type { CelluleConfig } from './config.js';
import { buildCellSearchUrl } from '../url.js';
import type { SeedRepository } from './types.js';

export const VERIFY_PLAFOND_CENTS = 1200;
export const VERIFY_ARRET_DUR_CENTS = 1000;
/** Seuil de volume : annonces actives de la marque dans la cellule. */
export const VERIFY_SEUIL_ACTIVES = 200;
export const VERIFY_MAX_ITEMS = 250;
/** Cellules pilotes (une par catégorie), repérées par leur marque. */
export const PILOTES = ['Nike', 'Sézane', 'Apple'] as const;

export type EtapeVerif = 'pilotes' | 'reste';

export interface VerifCible {
  nom: string;
  marque: string;
  catalogId: number | null;
  url: string | null;
  /** Motif empêchant la mesure (vide = mesurable). */
  refus: string[];
}

export function ciblesVerification(configs: readonly CelluleConfig[], etape: EtapeVerif) {
  const estPilote = (c: CelluleConfig) => (PILOTES as readonly string[]).includes(c.marque);
  return configs
    .filter((c) => (etape === 'pilotes' ? estPilote(c) : !estPilote(c)))
    .map((c): VerifCible => ({
      nom: `${c.categorie}|${c.marque}`,
      marque: c.marque,
      catalogId: c.catalogId,
      url: c.catalogId === null ? null : buildCellSearchUrl(c.catalogId, c.marque, c.taille),
      refus: c.catalogId === null ? ['identifiant de catalogue inconnu (catalogId: null)'] : [],
    }));
}

export function verifyBudget(coutParResultatMilli: number): BudgetConfig {
  // Imputé sur l'enveloppe « découverte » de la campagne de vérification.
  return {
    hardStopCents: VERIFY_ARRET_DUR_CENTS,
    suiviCents: 0,
    decouverteCents: VERIFY_ARRET_DUR_CENTS,
    coutParResultatMilli,
  };
}

const eur = (cents: number) => formatMilli(cents * MILLI_PAR_CENTIME);

export function formatVerifPlan(
  cibles: readonly VerifCible[],
  etape: EtapeVerif,
  campagne: string,
  maxItems: number,
  tarifs: readonly number[],
): string {
  const l: string[] = [];
  l.push(
    `seed:verify-volume — DRY-RUN, aucune dépense, aucun appel Apify (campagne ${campagne}, étape ${etape})`,
  );
  l.push(
    `Budget de vérification : plafond ${eur(VERIFY_PLAFOND_CENTS)}, arrêt dur ${eur(VERIFY_ARRET_DUR_CENTS)}`,
  );
  l.push(
    `Mesure : ${maxItems} résultats max par cellule ; seuil ${VERIFY_SEUIL_ACTIVES} annonces actives de la marque`,
  );
  l.push('');
  for (const c of cibles) {
    l.push(`  - ${c.nom} [catalogue ${c.catalogId ?? '?'}]`);
    l.push(c.url ? `      ${c.url}` : `      REFUSÉE : ${c.refus.join(' ; ')}`);
  }
  const mesurables = cibles.filter((c) => c.refus.length === 0).length;
  l.push('');
  l.push(`Cellules mesurables : ${mesurables} / ${cibles.length}`);
  for (const t of tarifs) {
    const parCellule = maxItems * t;
    const total = parCellule * mesurables;
    const totalPrevu = parCellule * cibles.length;
    const arret = VERIFY_ARRET_DUR_CENTS * MILLI_PAR_CENTIME;
    l.push(
      `  Tarif ${eur(t)} / 1 000 : ${formatMilli(parCellule)} max par cellule ; ` +
        `${formatMilli(total)} pour les mesurables, ${formatMilli(totalPrevu)} si toutes l'étaient` +
        (totalPrevu > arret ? ` ⚠️ dépasse l'arrêt dur de ${eur(VERIFY_ARRET_DUR_CENTS)}` : ''),
    );
  }
  l.push('');
  l.push('dry-run, aucune dépense');
  return l.join('\n');
}

export interface VerifResultat {
  nom: string;
  catalogId: number;
  resultats: number;
  /** Annonces dont la marque se rattache à la cellule. */
  marque: number;
  plafondAtteint: boolean;
  verdict: 'OK' | 'SOUS_SEUIL' | 'ZERO';
  coutMilli: number;
}

export interface VerifyRunOptions {
  campagne: string;
  cibles: readonly VerifCible[];
  coutParResultatMilli: number;
  maxItems: number;
  resolver: BrandResolver;
  repo: Pick<SeedRepository, 'campaignSpent' | 'startRun' | 'recordSpend' | 'finishRun'>;
  /** Recherche brute plafonnée (Apify) : renvoie les items bruts. */
  search: (url: string, maxItems: number) => Promise<unknown[]>;
  /** Marque brute d'un item (normalisation). */
  marqueOf: (raw: unknown) => string | null;
  now?: () => Date;
}

export interface VerifyRunResult {
  statut: 'COMPLETED' | 'STOPPED' | 'BUDGET_STOPPED';
  resultats: VerifResultat[];
  arret: string | null;
  depenseCampagneMilli: number;
}

/** Mesure les cellules une à une ; s'arrête au premier échec ou au budget. */
export async function runVerifyVolume(o: VerifyRunOptions): Promise<VerifyRunResult> {
  const now = o.now ?? (() => new Date());
  const refusees = o.cibles.filter((c) => c.refus.length > 0);
  if (refusees.length > 0) {
    throw new Error(
      `Cellules non mesurables : ${refusees.map((c) => `${c.nom} (${c.refus.join(' ; ')})`).join(', ')}`,
    );
  }
  const ledger = new BudgetLedger(
    verifyBudget(o.coutParResultatMilli),
    await o.repo.campaignSpent(o.campagne),
  );
  const runId = await o.repo.startRun(o.campagne, VERIFY_ARRET_DUR_CENTS, now());
  const resultats: VerifResultat[] = [];
  let arret: string | null = null;
  let budgetStop = false;
  let erreurs = 0;

  for (const c of o.cibles) {
    const r = ledger.reserve('decouverte', o.maxItems);
    if (typeof r === 'string') {
      budgetStop = true;
      arret = `ARRÊT DUR : budget de vérification de ${eur(VERIFY_ARRET_DUR_CENTS)} atteint avant ${c.nom}.`;
      break;
    }
    let items: unknown[];
    try {
      items = await o.search(c.url as string, o.maxItems);
    } catch (err) {
      ledger.commit(r, o.maxItems); // prudence : coût maximal compté
      await o.repo.recordSpend(runId, 'decouverte', r.maxMilli, o.maxItems);
      erreurs++;
      arret = `Échec de la mesure de ${c.nom} : ${String(err)}`;
      break;
    }
    const { milli } = ledger.commit(r, items.length);
    await o.repo.recordSpend(runId, 'decouverte', milli, items.length);
    const marque = items.filter((raw) => o.resolver.resolve(o.marqueOf(raw)) === c.marque).length;
    const plafondAtteint = items.length >= o.maxItems;
    const verdict =
      items.length === 0 ? 'ZERO' : marque >= VERIFY_SEUIL_ACTIVES ? 'OK' : 'SOUS_SEUIL';
    resultats.push({
      nom: c.nom,
      catalogId: c.catalogId as number,
      resultats: items.length,
      marque,
      plafondAtteint,
      verdict,
      coutMilli: milli,
    });
    if (verdict !== 'OK') {
      arret =
        verdict === 'ZERO'
          ? `Arrêt : 0 résultat pour ${c.nom} (catalogue ou libellé inattendu) — arbitrage requis.`
          : `Arrêt : ${c.nom} sous le seuil (${marque} annonces de la marque < ${VERIFY_SEUIL_ACTIVES}) — catégorie à reconsidérer.`;
      break;
    }
  }

  const statut = budgetStop ? 'BUDGET_STOPPED' : arret ? 'STOPPED' : 'COMPLETED';
  await o.repo.finishRun(
    runId,
    {
      statut: budgetStop ? 'BUDGET_STOPPED' : erreurs > 0 ? 'PARTIAL' : 'COMPLETED',
      annoncesVerifiees: 0,
      nouvellesAnnonces: 0,
      ventesDetectees: 0,
      disparitions: 0,
      erreurs,
      details: { verification: resultats, arret },
    },
    now(),
  );
  return { statut, resultats, arret, depenseCampagneMilli: ledger.totalMilli };
}
