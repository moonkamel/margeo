import { beforeEach, describe, expect, it } from 'vitest';
import {
  BrandResolver,
  ciblesVerification,
  formatVerifPlan,
  readCellules,
  runVerifyVolume,
  VERIFY_ARRET_DUR_CENTS,
  VERIFY_MAX_ITEMS,
  type VerifCible,
} from '../../src/seed/index.js';
import { MemoryRepo } from './memory-repo.js';

const PATH = new URL('../../seed/cellules.json', import.meta.url).pathname;

describe('ciblesVerification', () => {
  const configs = readCellules(PATH);

  it('étape pilotes : Nike et Adidas (1242), Sézane (13), toutes mesurables', () => {
    const p = ciblesVerification(configs, 'pilotes');
    expect(p.map((c) => [c.nom, c.catalogId])).toEqual([
      ['Baskets (H)|Nike', 1242],
      ['Baskets (H)|Adidas', 1242],
      ['Sweats et sweats à capuche (F)|Sézane', 13],
    ]);
    expect(p[2]?.url).toBe(
      'https://www.vinted.fr/catalog?catalog%5B%5D=13&search_text=S%C3%A9zane&order=newest_first',
    );
    expect(p.every((c) => c.refus.length === 0)).toBe(true);
  });

  it('étape reste : les 12 autres cellules', () => {
    expect(ciblesVerification(configs, 'reste')).toHaveLength(12);
  });

  it('dry-run : URL, coût max par tarif, alerte si l’arrêt dur serait dépassé', () => {
    const reste = ciblesVerification(configs, 'reste');
    const texte = formatVerifPlan(reste, 'reste', 'verify-2026-11', 200, [357], 0);
    expect(texte).toMatch(/DRY-RUN/);
    expect(texte).toMatch(/plafond 12,00 €, arrêt dur 11,00 €/);
    // 12 × 200 × 0,357 c = 8,57 € : sous l'arrêt dur (15 cellules : 10,71 € < 11 €).
    expect(texte).toMatch(/8,57 € si toutes l'étaient$/m);
    // 12 × 200 × 0,5 c = 12,00 € > 11 € → alerte.
    expect(formatVerifPlan(reste, 'reste', 'verify-2026-11', 200, [500], 0)).toMatch(
      /12,00 € si toutes l'étaient ⚠️ dépasse l'arrêt dur de 11,00 €/,
    );
    expect(texte.trim().endsWith('dry-run, aucune dépense')).toBe(true);
  });
});

it('valeurs par défaut : 200 résultats par cellule, arrêt dur 11 €', () => {
  expect([VERIFY_MAX_ITEMS, VERIFY_ARRET_DUR_CENTS]).toEqual([200, 1100]);
});

describe('runVerifyVolume — exécution en mock', () => {
  const cible = (marque: string, catalogId = 13): VerifCible => ({
    nom: `C|${marque}`,
    marque,
    catalogId,
    url: `https://www.vinted.fr/catalog?catalog%5B%5D=${catalogId}&m=${marque}`,
    refus: [],
  });
  const items = (marque: string, n: number) => Array.from({ length: n }, () => ({ marque }));
  let repo: MemoryRepo;
  let appels: string[];
  let catalogue: Map<string, unknown[]>;
  beforeEach(() => {
    repo = new MemoryRepo();
    appels = [];
    catalogue = new Map();
  });
  const run = (cibles: VerifCible[], tarif = 260) =>
    runVerifyVolume({
      campagne: 'verify-2026-11',
      cibles,
      coutParResultatMilli: tarif,
      coutParRunMilli: 0,
      maxItems: 250,
      resolver: new BrandResolver(
        cibles.map((c) => c.marque),
        [{ alias: 'Sezane', marque: 'Sézane', valide: true }],
      ),
      repo,
      search: async (url, max) => {
        appels.push(url);
        return { items: (catalogue.get(url) ?? []).slice(0, max) };
      },
      marqueOf: (raw) => (raw as { marque: string | null }).marque,
    });

  it('cellule non mesurable (catalogId inconnu) → refus avant tout appel', async () => {
    await expect(
      run([{ ...cible('Nike'), catalogId: null, url: null, refus: ['catalogId: null'] }]),
    ).rejects.toThrow(/non mesurables/);
    expect(appels).toEqual([]);
    expect(repo.runs).toEqual([]);
  });

  it('pilotes au-dessus du seuil : OK, alias comptés, dépense par appel dans verify-YYYY-MM', async () => {
    const a = cible('Sézane');
    const b = cible('Ralph Lauren', 79);
    catalogue.set(a.url as string, [
      ...items('Sézane', 150),
      ...items('Sezane', 60),
      ...items('Zara', 40),
    ]);
    catalogue.set(b.url as string, items('Ralph Lauren', 250));
    const r = await run([a, b]);
    expect(r.statut).toBe('COMPLETED');
    expect(r.resultats.map((x) => [x.verdict, x.marque, x.plafondAtteint])).toEqual([
      ['OK', 210, true],
      ['OK', 250, true],
    ]);
    expect(repo.spendLog).toEqual([
      { envelope: 'decouverte', milli: 250 * 260 },
      { envelope: 'decouverte', milli: 250 * 260 },
    ]);
    expect(repo.runs[0]?.campagne).toBe('verify-2026-11');
  });

  it('pilote sous le seuil → arrêt, cellules suivantes non mesurées', async () => {
    const a = cible('Sézane');
    const b = cible('Maje');
    catalogue.set(a.url as string, items('Sézane', 120));
    const r = await run([a, b]);
    expect(r.statut).toBe('STOPPED');
    expect(r.arret).toMatch(/sous le seuil \(120 annonces de la marque < 200\)/);
    expect(appels).toHaveLength(1);
  });

  it('0 résultat → arrêt pour arbitrage du catalogue', async () => {
    const r = await run([cible('Sézane'), cible('Maje')]);
    expect(r.resultats[0]?.verdict).toBe('ZERO');
    expect(r.arret).toMatch(/0 résultat.*arbitrage/);
    expect(appels).toHaveLength(1);
  });

  it('arrêt dur à 11,00 € : atteint pile, jamais dépassé, même sur un run suivant', async () => {
    // 1,1 c par résultat × 250 = 2,75 € par cellule : 4 mesures = 11,00 €, la 5e est refusée.
    const cibles = Array.from({ length: 6 }, (_, i) => cible(`M${i}`, 100 + i));
    for (const c of cibles) catalogue.set(c.url as string, items(c.marque, 250));
    const r = await run(cibles, 1100);
    expect(r.statut).toBe('BUDGET_STOPPED');
    expect(r.resultats).toHaveLength(4);
    expect(r.depenseCampagneMilli).toBe(VERIFY_ARRET_DUR_CENTS * 1000);
    expect(r.arret).toMatch(/ARRÊT DUR : budget de vérification de 11,00 € atteint avant C\|M4/);
    appels.length = 0;
    const apres = await run(cibles.slice(4), 1100);
    expect(apres.statut).toBe('BUDGET_STOPPED');
    expect(appels).toEqual([]);
    expect(repo.totalSpent()).toBe(VERIFY_ARRET_DUR_CENTS * 1000);
  });

  it('frais fixes par run comptés : 200 résultats × 0,26 c + 5 c = 57 c par cellule', async () => {
    const a = cible('Sézane');
    catalogue.set(a.url as string, items('Sézane', 200));
    const r = await runVerifyVolume({
      campagne: 'verify-2026-11',
      cibles: [a],
      coutParResultatMilli: 260,
      coutParRunMilli: 5000,
      maxItems: 200,
      resolver: new BrandResolver(['Sézane'], []),
      repo,
      search: async (url, max) => ({ items: (catalogue.get(url) ?? []).slice(0, max) }),
      marqueOf: (raw) => (raw as { marque: string }).marque,
    });
    expect(r.resultats[0]?.coutMilli).toBe(57_000);
    expect(repo.totalSpent()).toBe(57_000);
  });

  it('plafond de plateforme dérivé de la réservation ; run coupé sous le seuil → INCOMPLET', async () => {
    const plafonds: number[] = [];
    const a = cible('Sézane');
    const b = cible('Maje');
    const r = await runVerifyVolume({
      campagne: 'verify-2026-11',
      cibles: [a, b],
      coutParResultatMilli: 240,
      coutParRunMilli: 5000,
      maxItems: 200,
      resolver: new BrandResolver(['Sézane', 'Maje'], []),
      repo,
      search: async (_url, _max, plafond) => {
        plafonds.push(plafond.maxTotalChargeUsd);
        return { items: items('Sézane', 111), runCoupe: true, coutReelMilli: 26_700 };
      },
      marqueOf: (raw) => (raw as { marque: string }).marque,
    });
    // Réservation 200 × 0,24 c + 5 c = 53 c → 0,53 / 0,92 × 1,5 = 0,864… → 0,87 $.
    expect(plafonds).toEqual([0.87]);
    expect(r.resultats[0]?.verdict).toBe('INCOMPLET');
    expect(r.arret).toMatch(/run coupé pour C\|Sézane après 111 résultats.*à relancer/);
    // Run coupé : la réservation maximale est gardée, pas le coût réel rapporté.
    expect(repo.spendLog).toEqual([{ envelope: 'decouverte', milli: 53_000 }]);
  });

  it('run coupé AU-DESSUS du seuil : verdict OK (le volume est démontré)', async () => {
    const a = cible('Nike');
    const r = await runVerifyVolume({
      campagne: 'verify-2026-11',
      cibles: [a],
      coutParResultatMilli: 240,
      coutParRunMilli: 5000,
      maxItems: 250,
      resolver: new BrandResolver(['Nike'], []),
      repo,
      search: async () => ({ items: items('Nike', 210), runCoupe: true }),
      marqueOf: (raw) => (raw as { marque: string }).marque,
    });
    expect(r.resultats[0]?.verdict).toBe('OK');
  });

  it('échec de l’acteur : coût maximal compté par prudence, arrêt', async () => {
    const r = await runVerifyVolume({
      campagne: 'verify-2026-11',
      cibles: [cible('Sézane'), cible('Maje')],
      coutParResultatMilli: 260,
      coutParRunMilli: 0,
      maxItems: 250,
      resolver: new BrandResolver(['Sézane', 'Maje'], []),
      repo,
      search: () => Promise.reject(new Error('timeout')),
      marqueOf: () => null,
    });
    expect(r.statut).toBe('STOPPED');
    expect(r.arret).toMatch(/Échec de la mesure de C\|Sézane/);
    expect(repo.spendLog).toEqual([{ envelope: 'decouverte', milli: 250 * 260 }]);
  });
});
