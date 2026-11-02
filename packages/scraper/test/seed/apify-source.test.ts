import { describe, expect, it } from 'vitest';
import {
  ABOTAPI_INPUT_BUILDERS,
  type ActorRunner,
  type LimitesRun,
  type RunActeur,
} from '../../src/index.js';
import { ApifySeedSource, subcategoryIdOf } from '../../src/seed/index.js';
import { item } from '../load-fixture.js';
import { cellule } from './fake-source.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const url = (id: string) => `https://www.vinted.fr/items/${id}-x`;
const PLAFOND = { maxTotalChargeUsd: 0.87 };

/** Runner factice : enregistre input et plafonds, renvoie le run configuré. */
class FakeRunner implements ActorRunner {
  appels: { input: unknown; limites: LimitesRun }[] = [];
  constructor(private readonly reponse: Partial<RunActeur>) {}
  async run(input: unknown, limites: LimitesRun): Promise<RunActeur> {
    this.appels.push({ input, limites });
    return {
      runId: 'r1',
      statut: 'SUCCEEDED',
      coupe: false,
      items: [],
      usageTotalUsd: null,
      ...this.reponse,
    };
  }
}
const source = (runner: ActorRunner) =>
  new ApifySeedSource(runner, ABOTAPI_INPUT_BUILDERS, () => NOW);

const LOT = [
  item('api-active'), // 4817263512
  item('api-sold'), // 4817263599
  item('closed-not-sold'), // 4817265555
  { ...(item('no-price') as object), id: 4817260001 }, // illisible
  item('deleted'), // sans id : ignoré
];
const URLS = ['4817263512', '4817263599', '4817265555', '4817260001', '4817269999'].map(url);

describe('ApifySeedSource.recheck — lot en un seul run', () => {
  it('classe chaque annonce ; plafonds de plateforme : maxItems exact + maxTotalChargeUsd', async () => {
    const runner = new FakeRunner({ items: LOT, usageTotalUsd: 0.06 });
    const r = await source(runner).recheck(URLS, PLAFOND);
    expect(runner.appels).toHaveLength(1);
    expect(runner.appels[0]?.limites).toEqual({ maxItems: 5, maxTotalChargeUsd: 0.87 });
    expect(runner.appels[0]?.input).toMatchObject({ mode: 'url', maxItems: 5 });
    expect(r.results.map((x) => x.outcome)).toEqual([
      'active',
      'sold',
      'closed',
      'illisible',
      'not_found',
    ]);
    expect(r.resultatsFactures).toBe(5);
    // 0,06 $ × 0,92 = 0,0552 € = 5 520 milli, arrondi au-dessus.
    expect(r.coutReelMilli).toBe(5520);
    expect(r.runCoupe).toBe(false);
  });

  it('run coupé : les annonces absentes ne sont PAS « introuvables » (pas de fausse disparition)', async () => {
    const runner = new FakeRunner({ items: LOT.slice(0, 2), coupe: true, statut: 'TIMED-OUT' });
    const r = await source(runner).recheck(URLS, PLAFOND);
    expect(r.runCoupe).toBe(true);
    expect(r.results.map((x) => x.outcome)).toEqual([
      'active',
      'sold',
      'illisible',
      'illisible',
      'illisible',
    ]);
    expect(r.results.every((x) => x.outcome !== 'not_found')).toBe(true);
  });

  it('plafond de coût obligatoire : refus sans appel', async () => {
    const runner = new FakeRunner({});
    await expect(source(runner).recheck(URLS)).rejects.toThrow(/Plafond de coût/);
    expect(runner.appels).toHaveLength(0);
  });

  it('lot vide → aucun appel', async () => {
    const runner = new FakeRunner({});
    expect(await source(runner).recheck([], PLAFOND)).toEqual({
      results: [],
      resultatsFactures: 0,
    });
    expect(runner.appels).toHaveLength(0);
  });
});

describe('ApifySeedSource.discover', () => {
  it('recherche sur le catalogue exact, plafonds transmis, items normalisables gardés', async () => {
    const runner = new FakeRunner({
      items: [item('api-active'), item('flat-active'), item('no-price')],
    });
    const { listings, resultatsFactures } = await source(runner).discover(
      cellule('Sweats et pulls (H)', 'Ralph Lauren', { catalogId: 79 }),
      5,
      PLAFOND,
    );
    expect(runner.appels[0]?.limites).toEqual({ maxItems: 5, maxTotalChargeUsd: 0.87 });
    expect(runner.appels[0]?.input).toStrictEqual({
      mode: 'search',
      queries: ['Ralph Lauren'],
      categoryId: '79',
      maxItems: 5,
      fetchDetails: true,
      sortBy: 'newest_first',
    });
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.subcategoryId)).toEqual([257, null]);
    expect(resultatsFactures).toBe(3);
  });
});

describe('subcategoryIdOf', () => {
  it.each([
    [{ catalog_id: 1811 }, 1811],
    [{ catalog_id: '1811' }, 1811],
    [{ catalog: { id: 79 } }, 79],
    [{ catalog_id: 0 }, null],
    [{ catalog_id: 'x' }, null],
    [{}, null],
    [null, null],
  ])('%j → %s', (raw, attendu) => {
    expect(subcategoryIdOf(raw)).toBe(attendu);
  });
});
