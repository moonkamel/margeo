import type { ModeleActif } from '@margeo/shared';
import { abotapiSearchInput, abotapiUrlInput } from '../drivers/abotapi-input.js';
import type { ActorRunner, RunActeur } from '../drivers/apify-async.js';
import { buildModelSearchUrl, parseVintedItemUrl } from '../url.js';
import { ARRET_DUR_RATIO, usdToMilli, type BudgetConfig } from '../seed/budget.js';
import type { Facturation, PlafondAppel } from '../seed/types.js';
import type { ScanSource } from './run-scan.js';

/** Plafond mensuel du scan (décision du 2026-11-03 : 10 $ ≈ 9,20 €), en centimes. */
export const SCAN_PLAFOND_CENTS = 920;

/**
 * Budget du scan : campagne séparée du seed, arrêt dur à 80 % du plafond (7,36 € pour 9,20 €).
 * Tout est imputé sur une seule enveloppe (pas de suivi : le scan ne re-vérifie rien).
 */
export function budgetScan(
  plafondCents: number,
  coutParResultatMilli: number,
  coutParRunMilli: number,
): BudgetConfig {
  const hardStopCents = Math.floor(plafondCents * ARRET_DUR_RATIO);
  return {
    hardStopCents,
    suiviCents: 0,
    decouverteCents: hardStopCents,
    coutParResultatMilli,
    coutParRunMilli,
  };
}

function facturation(run: RunActeur): Facturation {
  return {
    resultatsFactures: run.items.length,
    ...(run.usageTotalUsd === null ? {} : { coutReelMilli: usdToMilli(run.usageTotalUsd) }),
    runCoupe: run.coupe,
  };
}

/** Adaptateur Apify (abotapi, runs asynchrones) → ScanSource. Plafonds de plateforme à chaque run. */
export class ApifyScanSource implements ScanSource {
  constructor(private readonly runner: ActorRunner) {}

  async rechercher(modele: ModeleActif, maxItems: number, plafond: PlafondAppel) {
    const url = buildModelSearchUrl(modele.catalogId, modele.searchText);
    const run = await this.runner.run(abotapiSearchInput(url, maxItems, { fetchDetails: false }), {
      maxItems,
      maxTotalChargeUsd: plafond.maxTotalChargeUsd,
    });
    return { items: run.items, ...facturation(run) };
  }

  async details(urls: readonly string[], plafond: PlafondAppel) {
    if (urls.length === 0) return { items: [], resultatsFactures: 0 };
    const canoniques = urls.map((u) => parseVintedItemUrl(u).canonicalUrl);
    const run = await this.runner.run(abotapiUrlInput(canoniques), {
      maxItems: canoniques.length,
      maxTotalChargeUsd: plafond.maxTotalChargeUsd,
    });
    return { items: run.items, ...facturation(run) };
  }
}
