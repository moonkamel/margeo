/**
 * Runs asynchrones et coût réel (décisions du 2026-11-04) : plafond de plateforme dérivé de la
 * réservation, ajustement au coût réel, réservation maximale gardée pour un run coupé.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marqueBrute } from '../../src/index.js';
import {
  budgetDepuisPlafond,
  plafondRunUsd,
  runSeed,
  usdToMilli,
  type Cellule,
  type PlafondAppel,
  type SeedSource,
  type TrackedState,
} from '../../src/seed/index.js';
import { cellule, listing } from './fake-source.js';
import { MemoryRepo } from './memory-repo.js';

const T0 = new Date('2026-11-10T05:00:00Z').getTime();
const CELL: Cellule = cellule('Baskets (H)', 'Nike', { catalogId: 1242, cibleActives: 100 });
const BUDGET = budgetDepuisPlafond(10_000, 240, 5000);
// Réservation d'un lot de 100 : 5 c + 100 × 0,24 c = 29 c.
const RESERVATION_100 = 29_000;

function parc(repo: MemoryRepo, n: number) {
  const d = new Date(T0 - 48 * 3600_000);
  for (let i = 0; i < n; i++) {
    const t: TrackedState = {
      id: `t${i}`,
      plateforme: 'VINTED',
      externalId: `t${i}`,
      url: `https://www.vinted.fr/items/t${i}-x`,
      categorie: CELL.categorie,
      marque: 'Nike',
      taille: '42',
      prixInitialCents: 1000,
      prixCourantCents: 1000,
      etat: 'BON',
      statut: 'ACTIVE',
      premiereVuAt: d,
      derniereVuAt: d,
      derniereVerifAt: d,
      echecsConsecutifs: 0,
      soldAt: null,
      soldPrixCents: null,
      soldSource: null,
      catalogIdRecherche: 1242,
      subcategoryId: 1242,
      subcategoryLabel: 'Hommes Baskets',
    };
    repo.state.tracked.set(t.id, t);
  }
}

/** Source asynchrone simulée : `n` annonces vérifiées, coût réel et coupure configurables. */
function source(o: { verifiees: number; coutReelMilli?: number; runCoupe?: boolean }) {
  const plafonds: PlafondAppel[] = [];
  const s: SeedSource = {
    async recheck(urls, plafond) {
      if (plafond) plafonds.push(plafond);
      const results = urls.slice(0, o.verifiees).map((url) => ({
        url,
        outcome: 'active' as const,
        listing: listing({ externalId: url.split('/').pop() ?? 'x' }),
        payload: {},
      }));
      const reste = urls.slice(o.verifiees).map((url) => ({
        url,
        outcome: 'illisible' as const,
        detail: 'run coupé avant vérification',
      }));
      return {
        results: [...results, ...reste],
        resultatsFactures: o.verifiees,
        ...(o.coutReelMilli === undefined ? {} : { coutReelMilli: o.coutReelMilli }),
        ...(o.runCoupe === undefined ? {} : { runCoupe: o.runCoupe }),
      };
    },
    async discover() {
      return { listings: [], resultatsFactures: 0 };
    },
  };
  return { s, plafonds };
}
const run = (repo: MemoryRepo, s: SeedSource) =>
  runSeed({
    campagne: 'async',
    cellules: [CELL],
    budget: BUDGET,
    source: s,
    repo,
    now: () => new Date(T0),
  });

describe('plafond de plateforme et conversion', () => {
  it('200 résultats à 2,40 € / 1 000 + 0,05 € : 0,53 € → 0,58 $ → × 1,5 = 0,87 $', () => {
    expect(plafondRunUsd(5000 + 200 * 240)).toBe(0.87);
  });
  it('plancher 0,10 $ pour les petits runs', () => {
    expect(plafondRunUsd(5000 + 1 * 240)).toBe(0.1);
  });
  it('dollars → milli d’euro, arrondi au-dessus', () => {
    expect(usdToMilli(0.29)).toBe(26_680);
    expect(usdToMilli(0.0225)).toBe(2070);
  });
});

describe('runs asynchrones : coût enregistré', () => {
  it('le plafond transmis découle de la réservation du lot', async () => {
    const repo = new MemoryRepo();
    parc(repo, 100);
    const { s, plafonds } = source({ verifiees: 100 });
    await run(repo, s);
    expect(plafonds).toEqual([{ maxTotalChargeUsd: plafondRunUsd(RESERVATION_100) }]);
  });

  it('run qui consomme 60 % du réservé : le ledger s’ajuste à la baisse', async () => {
    const repo = new MemoryRepo();
    parc(repo, 100);
    const reel = Math.round(RESERVATION_100 * 0.6); // 17 400 milli
    const { s } = source({ verifiees: 60, coutReelMilli: reel });
    await run(repo, s);
    // Estimation 5 c + 60 × 0,24 c = 19,4 c ; coût réel rapporté 17,4 c : le plus élevé des deux
    // (Apify finalise parfois son compteur en retard), toujours sous la réservation de 29 c.
    expect(repo.spendLog.map((x) => x.milli)).toEqual([19_400]);
    expect(repo.totalSpent()).toBeLessThan(RESERVATION_100);
  });

  it('coût réel supérieur à l’estimation : c’est le coût réel qui est retenu', async () => {
    const repo = new MemoryRepo();
    parc(repo, 100);
    const { s } = source({ verifiees: 60, coutReelMilli: 21_000 });
    await run(repo, s);
    expect(repo.spendLog.map((x) => x.milli)).toEqual([21_000]);
  });

  it('run coupé : la réservation maximale est gardée, quel que soit le coût rapporté', async () => {
    const repo = new MemoryRepo();
    parc(repo, 100);
    const { s } = source({ verifiees: 30, coutReelMilli: 10_000, runCoupe: true });
    const r = await run(repo, s);
    expect(repo.spendLog.map((x) => x.milli)).toEqual([RESERVATION_100]);
    // Les 70 annonces non vérifiées restent intactes (aucun échec compté) et le repli à 50 s'arme.
    const intactes = [...repo.state.tracked.values()].filter((t) => t.echecsConsecutifs === 0);
    expect(intactes).toHaveLength(100);
    expect(r.details['recheckTimeout']).toBe(true);
    expect(r.alertes.some((a) => a.startsWith('Run de re-vérification coupé'))).toBe(true);
  });
});

describe('marqueBrute — comptage sans fetchDetails', () => {
  const P = JSON.parse(
    readFileSync(new URL('../fixtures/payloads-acteurs.json', import.meta.url), 'utf8'),
  ) as Record<'abotapiNike', Record<string, unknown>>;

  it('annonce de recherche sans détails (ni état ni taille) : marque lue quand même', () => {
    const { condition: _c, size: _s, brand: _b, ...recherche } = P.abotapiNike;
    void _c;
    void _s;
    void _b;
    expect(marqueBrute(recherche)).toBe('Nike'); // brandTitle
    expect(marqueBrute(P.abotapiNike)).toBe('Nike'); // objet brand
    expect(marqueBrute({ brand_title: ' Sézane ' })).toBe('Sézane');
    expect(marqueBrute({ itemId: '1', priceAmount: 3 })).toBeNull();
    expect(marqueBrute(null)).toBeNull();
  });
});
