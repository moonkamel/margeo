/**
 * Lots de re-vérification de 100 (décision du 2026-11-04) : repli à 50 après un timeout,
 * échec partiel sans perte des autres annonces du lot.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ScraperError } from '../../src/index.js';
import {
  budgetDepuisPlafond,
  runSeed,
  TAILLE_LOT_REVERIFICATION,
  type Cellule,
  type TrackedState,
} from '../../src/seed/index.js';
import { cellule, FakeSource, listing } from './fake-source.js';
import { MemoryRepo } from './memory-repo.js';

const H = 3600_000;
const T0 = new Date('2026-11-10T05:00:00Z').getTime();
const CELL: Cellule = cellule('Baskets (H)', 'Nike', { catalogId: 1242, cibleActives: 250 });

function suivie(i: number): TrackedState {
  const d = new Date(T0 - 48 * H);
  return {
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
}

let repo: MemoryRepo;
let source: FakeSource;
let clock: number;

function parc(n: number) {
  for (let i = 0; i < n; i++) {
    const t = suivie(i);
    repo.state.tracked.set(t.id, t);
    source.monde.set(t.url, listing({ externalId: t.externalId }));
  }
}
const run = (o: { lot?: number } = {}) =>
  runSeed({
    campagne: 'lots',
    cellules: [CELL],
    budget: budgetDepuisPlafond(10_000, 260, 5000),
    source,
    repo,
    now: () => new Date(clock),
    ...(o.lot === undefined ? {} : { tailleLotReverification: o.lot }),
  });
const lots = () => source.appels.filter((a) => a.type === 'recheck').map((a) => a.taille);

beforeEach(() => {
  repo = new MemoryRepo();
  source = new FakeSource();
  clock = T0;
});

describe('lots de re-vérification', () => {
  it('100 par défaut', async () => {
    expect(TAILLE_LOT_REVERIFICATION).toBe(100);
    parc(250);
    const r = await run();
    expect(lots()).toEqual([100, 100, 50]);
    expect(r.details['tailleLot']).toBe(100);
  });

  it('échec partiel : 1 annonce illisible sur 100 → 99 persistées, seule la 100e est reprise', async () => {
    parc(100);
    source.monde.set('https://www.vinted.fr/items/t37-x', 'illisible');
    const r = await run();
    expect(lots()).toEqual([100]);
    expect(r.annoncesVerifiees).toBe(99);
    expect(r.erreurs).toBe(1);
    const verifiees = [...repo.state.tracked.values()].filter(
      (t) => t.derniereVerifAt.getTime() === T0,
    );
    expect(verifiees).toHaveLength(99);
    expect(repo.byExternalId('t37')?.derniereVerifAt.getTime()).toBe(T0 - 48 * H);
    expect(repo.state.observations).toHaveLength(99);

    // Run suivant (1 h plus tard) : seule l'annonce en échec est re-vérifiée.
    source.monde.set('https://www.vinted.fr/items/t37-x', listing({ externalId: 't37' }));
    clock += H;
    source.appels.length = 0;
    const r2 = await run();
    expect(lots()).toEqual([1]);
    expect(r2.annoncesVerifiees).toBe(1);
  });

  it('timeout : lots réduits à 50 dans le run, puis au run suivant ; retour à 100 ensuite', async () => {
    parc(250);
    source.failNext = new ScraperError('timeout', 'Run Apify hors délai (408)');
    const r1 = await run();
    // Lot de 100 en échec (aucune annonce modifiée), puis 50 + 50 + 50 pour le reste.
    expect(lots()).toEqual([100, 50, 50, 50]);
    expect(r1.details['recheckTimeout']).toBe(true);
    expect(r1.alertes).toContain(
      'Timeout sur un lot de re-vérification de 100 annonces : lots réduits à 50 pour ce run et le suivant.',
    );
    // Les 100 annonces du lot en échec n'ont pas été touchées : reprises au run suivant.
    expect(
      [...repo.state.tracked.values()].filter((t) => t.derniereVerifAt.getTime() === T0 - 48 * H),
    ).toHaveLength(100);

    clock += 24 * H;
    source.appels.length = 0;
    const r2 = await run();
    expect(lots()).toEqual([50, 50, 50, 50, 50]); // run suivant : repli maintenu, sans timeout
    expect(r2.details['recheckTimeout']).toBe(false);

    clock += 24 * H;
    source.appels.length = 0;
    await run();
    expect(lots()).toEqual([100, 100, 50]); // plus de timeout : retour à 100
  });

  it('un autre type d’échec ne réduit pas les lots', async () => {
    parc(250);
    source.failNext = new Error('panne réseau');
    const r = await run();
    expect(lots()).toEqual([100, 100, 50]);
    expect(r.details['recheckTimeout']).toBe(false);
  });
});
