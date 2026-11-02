/**
 * Décisions 2b du 2026-11-03 / 2026-11-04 : plafond → arrêt dur 80 %, enveloppes 68/12,
 * campagne mensuelle, dry-run, rattachement par catalogue + alias, sous-catégories.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BrandResolver,
  BudgetLedger,
  budgetDepuisPlafond,
  campagneDuMois,
  formatSeedPlan,
  planSeedRun,
  premierDuMoisSuivant,
  readCellules,
  runSeed,
  type Cellule,
  type RunSeedOptions,
} from '../../src/seed/index.js';
import {
  CATALOGUE_TEST,
  cellule,
  FakeSource,
  listing,
  SOUS_CATEGORIE_TEST,
} from './fake-source.js';
import { MemoryRepo } from './memory-repo.js';

const EUR = 100_000;

describe('budgetDepuisPlafond — --budget-max est le PLAFOND', () => {
  it('plafond 100 € → arrêt dur 80 €, suivi 68 €, découverte 12 €', () => {
    expect(budgetDepuisPlafond(10_000, 260, 5000)).toEqual({
      hardStopCents: 8000,
      suiviCents: 6800,
      decouverteCents: 1200,
      coutParResultatMilli: 260,
      coutParRunMilli: 5000,
    });
  });

  it('les enveloppes tiennent dans l’arrêt dur (BudgetLedger les accepte)', () => {
    for (const plafond of [1, 99, 1200, 4800, 10_000, 12_345]) {
      const b = budgetDepuisPlafond(plafond, 260, 0);
      expect(b.suiviCents + b.decouverteCents).toBe(b.hardStopCents);
      expect(() => new BudgetLedger(b)).not.toThrow();
    }
  });

  it('plafond invalide refusé', () => {
    expect(() => budgetDepuisPlafond(0, 260, 0)).toThrow(RangeError);
    expect(() => budgetDepuisPlafond(10.5, 260, 0)).toThrow(RangeError);
  });

  it('dépense bornée à 80,00 € : un appel qui ferait 80,01 € est refusé', () => {
    const l = new BudgetLedger(budgetDepuisPlafond(10_000, 1000, 0)); // 1 c par résultat
    const r = l.reserve('suivi', 7999);
    if (typeof r === 'string') throw new Error('réservation refusée');
    l.commit(r, 7999);
    expect(l.reserve('suivi', 2)).toBe('budget_cap'); // 80,01 €
    expect(l.totalMilli).toBe(7999 * 1000);
    const l2 = new BudgetLedger(budgetDepuisPlafond(10_000, 1000, 0));
    const r2 = l2.reserve('suivi', 8000);
    if (typeof r2 === 'string') throw new Error('réservation refusée');
    l2.commit(r2, 8000);
    expect(l2.totalMilli).toBe(80 * EUR);
    expect(l2.stopped).toBe(true);
  });

  it('découverte coupée à 12 € pendant que le suivi continue', () => {
    const l = new BudgetLedger(budgetDepuisPlafond(10_000, 1000, 0));
    const d = l.reserve('decouverte', 1200);
    if (typeof d === 'string') throw new Error('réservation refusée');
    l.commit(d, 1200);
    expect(l.reserve('decouverte', 1)).toBe('decouverte_coupee');
    expect(typeof l.reserve('suivi', 100)).toBe('object');
  });
});

describe('campagne mensuelle (heure de Paris)', () => {
  it.each([
    ['2026-11-15T12:00:00Z', 'seed-2026-11', '01/12'],
    ['2026-11-30T23:30:00Z', 'seed-2026-12', '01/01'], // déjà le 1er décembre à Paris
    ['2026-12-31T22:59:00Z', 'seed-2026-12', '01/01'],
    ['2026-12-31T23:00:00Z', 'seed-2027-01', '01/02'],
  ])('%s → %s, prochain run %s', (iso, campagne, prochain) => {
    const d = new Date(iso);
    expect(campagneDuMois('seed', d)).toBe(campagne);
    expect(premierDuMoisSuivant(d)).toBe(prochain);
  });

  it('vérification du volume : campagne séparée verify-YYYY-MM', () => {
    expect(campagneDuMois('verify', new Date('2026-11-15T12:00:00Z'))).toBe('verify-2026-11');
  });
});

describe('planSeedRun — dry-run (aucun appel, aucune base)', () => {
  const path = new URL('../fixtures/cellules-15-reference.json', import.meta.url).pathname;

  it('cellules réelles : volumes par tier et coût maximal aux deux tarifs', () => {
    const plan = planSeedRun(readCellules(path), {
      plafondCents: 10_000,
      tarifs: [260, 357],
      coutParRunMilli: 0,
      batchSize: 50,
      maxDecouverteParCellule: 5,
    });
    // 5 × 70 + 5 × 30 + 5 × 20 = 600 annonces suivies par jour au parc complet.
    expect(plan.suiviJour).toBe(600);
    expect(plan.lotsJour).toBe(12);
    expect(plan.decouverteJourMax).toBe(75);
    expect(plan.crawlables).toBe(0);
    expect(plan.tarifs.map((t) => t.suiviMoisMilli)).toEqual([600 * 30 * 260, 600 * 30 * 357]);
    expect(plan.tarifs.every((t) => t.budget.hardStopCents === 8000)).toBe(true);
  });

  it('refus listés par cellule, message « dry-run, aucune dépense »', () => {
    const plan = planSeedRun(readCellules(path), {
      plafondCents: 10_000,
      tarifs: [260],
      coutParRunMilli: 0,
      batchSize: 50,
      maxDecouverteParCellule: 5,
    });
    const nike = plan.cellules.find((c) => c.nom === 'Baskets|Asics');
    expect(nike?.refus).toEqual([
      'non validée (valide: false)',
      'identifiant de catalogue inconnu (catalogId: null)',
    ]);
    const texte = formatSeedPlan(plan, 10_000, 'seed-2026-11');
    expect(texte).toMatch(/DRY-RUN/);
    expect(texte.trim().endsWith('dry-run, aucune dépense')).toBe(true);
    expect(texte).toMatch(/arrêt dur 80,00 € \(suivi 68,00 €, découverte 12,00 €\)/);
  });

  it('signale le jour d’arrêt dur si le rythme maximal l’atteint dans le mois', () => {
    const [t] = planSeedRun(readCellules(path), {
      plafondCents: 10_000,
      tarifs: [1000],
      coutParRunMilli: 0,
      batchSize: 50,
      maxDecouverteParCellule: 5,
    }).tarifs;
    // 600 × 1 c + 75 c = 6,75 €/jour (enveloppe découverte non épuisée) → 80 € le 12e jour.
    expect(t?.jourArretDur).toBe(12);
  });

  it('abotapi (240 c / 1 000, 5 c par run, lots de 100) : découverte coupée au jour 13, pas d’arrêt dur', () => {
    const plan = planSeedRun(readCellules(path), {
      plafondCents: 10_000,
      tarifs: [240],
      coutParRunMilli: 5000,
      batchSize: 100,
      maxDecouverteParCellule: 5,
    });
    const [t] = plan.tarifs;
    // Suivi : 600 × 0,24 c + 6 runs × 5 c = 1,74 €/j ; découverte : 75 × 0,24 c + 15 × 5 c = 0,93 €/j.
    expect([t?.suiviJourMilli, t?.decouverteJourMaxMilli]).toEqual([174_000, 93_000]);
    // 12 € de découverte : 12 × 0,93 = 11,16 € → épuisée le 13e jour, coupée ensuite.
    expect(t?.jourCoupureDecouverte).toBe(13);
    // 28 × 1,74 € + 12 € = 60,72 € ; 30 jours : 64,20 € < 80 € → pas d'arrêt dur.
    expect(t?.total4SemainesMilli).toBe(6_072_000);
    expect(t?.jourArretDur).toBeNull();
  });
});

describe('runSeed — rattachement par catalogue + marque (jamais le libellé)', () => {
  const H = 60 * 60 * 1000;
  const T0 = new Date('2026-11-10T05:00:00Z').getTime();
  const SEZANE: Cellule = cellule('Sweats et sweats à capuche (F)', 'Sézane', { catalogId: 13 });
  const ALIAS = new BrandResolver(
    ['Sézane'],
    [{ alias: 'Sezane', marque: 'Sézane', valide: true }],
  );
  let source: FakeSource;
  let repo: MemoryRepo;
  let clock: number;
  beforeEach(() => {
    source = new FakeSource();
    repo = new MemoryRepo();
    clock = T0;
  });
  const run = (o: Partial<RunSeedOptions> = {}) =>
    runSeed({
      campagne: 'test',
      cellules: [SEZANE],
      budget: budgetDepuisPlafond(10_000, 1000, 0),
      plafondCents: 10_000,
      brandResolver: ALIAS,
      source,
      repo,
      now: () => new Date(clock),
      ...o,
    });
  const pull = (externalId: string, o: Parameters<typeof listing>[0] | object = {}) =>
    listing({ externalId, marque: 'Sézane', categorie: 'Pulls à col roulé', ...o });

  it('libellé feuille ignoré, alias validé accepté, NB/Polo-like non rattaché', async () => {
    source.catalogue.set(`${SEZANE.categorie}|Sézane`, [
      pull('a'),
      pull('b', { marque: 'Sezane' }),
      pull('c', { marque: 'SÉZANE ' }),
      pull('d', { marque: 'Sézane Paris Vintage' }),
      pull('e', { marque: null }),
    ]);
    const r = await run();
    expect([...repo.state.tracked.values()].map((t) => t.externalId).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(r.details['rejets']).toEqual({
      [`13|Sézane|*`]: { marque: 2, sousCategorieAbsente: 0, horsParent: 0 },
    });
  });

  it('annonce suivie : marque canonique, libellé de cellule, catalogue, sous-catégorie', async () => {
    source.catalogue.set(`${SEZANE.categorie}|Sézane`, [pull('b', { marque: 'Sezane' })]);
    await run();
    expect(repo.byExternalId('b')).toMatchObject({
      marque: 'Sézane',
      categorie: 'Sweats et sweats à capuche (F)',
      catalogIdRecherche: 13,
      subcategoryId: SOUS_CATEGORIE_TEST,
      subcategoryLabel: 'Pulls à col roulé',
    });
    expect(repo.state.sousCategories.get(SOUS_CATEGORIE_TEST)).toEqual({
      parentId: 13,
      libelle: 'Pulls à col roulé',
    });
    expect(await repo.countActive(SEZANE)).toBe(1);
    expect(await repo.countActive({ ...SEZANE, catalogId: 79 })).toBe(0);
  });

  it('observations stockées : payload minimisé (aucune donnée vendeur ni description)', async () => {
    source.catalogue.set(`${SEZANE.categorie}|Sézane`, [pull('a')]);
    const brut = { itemId: 'a', title: 'Pull', sellerUsername: 'pseudo', description: '06…' };
    const discover = source.discover.bind(source);
    source.discover = async (c, n) => {
      const r = await discover(c, n);
      return { ...r, listings: r.listings.map((l) => ({ ...l, payload: brut })) };
    };
    await run();
    expect(repo.state.observations.map((o) => o.payload)).toEqual([{ itemId: 'a', title: 'Pull' }]);
  });

  it('sous-catégorie absente du payload → annonce écartée et comptée', async () => {
    source.catalogue.set(`${SEZANE.categorie}|Sézane`, [pull('a'), pull('x')]);
    source.sousCategorie.set('x', null);
    const r = await run();
    expect(repo.byExternalId('x')).toBeUndefined();
    expect(r.details['rejets']).toMatchObject({ '13|Sézane|*': { sousCategorieAbsente: 1 } });
  });

  it('élargissement : sous-catégorie connue sous un autre parent → écartée + alerte', async () => {
    repo.state.sousCategories.set(777, { parentId: 79, libelle: 'Pulls ras de cou' });
    source.catalogue.set(`${SEZANE.categorie}|Sézane`, [pull('a'), pull('y'), pull('z')]);
    source.sousCategorie.set('y', 777);
    source.sousCategorie.set('z', 777);
    const r = await run();
    expect(repo.byExternalId('y')).toBeUndefined();
    expect(repo.byExternalId('a')).toBeDefined();
    expect(r.details['rejets']).toMatchObject({ '13|Sézane|*': { horsParent: 2 } });
    const alertes = r.alertes.filter((a) => a.startsWith('Élargissement'));
    expect(alertes).toEqual([
      'Élargissement de recherche : sous-catégorie 777 rattachée au catalogue 79, reçue pour la cellule 13|Sézane|*. Annonces écartées.',
    ]);
    // La correspondance existante n'est jamais écrasée.
    expect(repo.state.sousCategories.get(777)?.parentId).toBe(79);
  });

  it('parc cible propre à chaque cellule (tier)', async () => {
    const autre = cellule('Sweats et pulls (H)', 'Ralph Lauren', {
      catalogId: 79,
      cibleActives: 2,
    });
    source.catalogue.set(
      `${SEZANE.categorie}|Sézane`,
      Array.from({ length: 10 }, (_, i) => pull(`s${i}`)),
    );
    source.catalogue.set(
      `${autre.categorie}|Ralph Lauren`,
      Array.from({ length: 10 }, (_, i) =>
        listing({ externalId: `r${i}`, marque: 'Ralph Lauren' }),
      ),
    );
    // Sous-catégorie propre au catalogue 79 (sinon : élargissement détecté, à raison).
    for (let i = 0; i < 10; i++) source.sousCategorie.set(`r${i}`, 601);
    await run({
      cellules: [{ ...SEZANE, cibleActives: 4 }, autre],
      brandResolver: new BrandResolver(['Sézane', 'Ralph Lauren'], []),
    });
    expect(source.appels.map((a) => a.taille)).toEqual([4, 2]);
    expect(await repo.countActive(autre)).toBe(2);
  });

  it('re-vérification : seules les annonces du seed consomment le budget', async () => {
    const base = {
      plateforme: 'VINTED' as const,
      categorie: 'Baskets',
      marque: 'Nike',
      taille: null,
      prixInitialCents: 1000,
      prixCourantCents: 1000,
      etat: 'BON' as const,
      statut: 'ACTIVE' as const,
      premiereVuAt: new Date(T0 - 48 * H),
      derniereVuAt: new Date(T0 - 48 * H),
      derniereVerifAt: new Date(T0 - 48 * H),
      echecsConsecutifs: 0,
      soldAt: null,
      soldPrixCents: null,
      soldSource: null,
      subcategoryId: null,
      subcategoryLabel: null,
    };
    repo.state.tracked.set('m', {
      ...base,
      id: 'm',
      externalId: 'm',
      url: 'https://www.vinted.fr/items/m-x',
      catalogIdRecherche: null,
    });
    repo.state.tracked.set('s', {
      ...base,
      id: 's',
      externalId: 's',
      url: 'https://www.vinted.fr/items/s-x',
      marque: 'Sézane',
      catalogIdRecherche: 13,
    });
    const r = await run({ cellules: [{ ...SEZANE, cibleActives: 1 }] });
    expect(source.appels).toEqual([{ type: 'recheck', taille: 1 }]);
    // Compteur interne : 1 annonce historique non rattachée, visible dans le résumé du run.
    expect(r.analysesNonRattachees).toBe(1);
    expect(r.details['analysesNonRattachees']).toBe(1);
  });

  it('arrêt dur : message « Budget seed à 80 % » avec prochain run et variable à ajuster', async () => {
    repo = new MemoryRepo({ suivi: 6800 * 1000, decouverte: 1200 * 1000 });
    const r = await run();
    expect(source.appels).toHaveLength(0);
    expect(r.statut).toBe('BUDGET_STOPPED');
    expect(r.alertes[0]).toBe(
      'ARRÊT DUR : Budget seed à 80 % du plafond de 100,00 € (80,00 € dépensés sur 80,00 € autorisés) — prochain run le 01/12 ou ajuster SEED_BUDGET_CENTS_MAX. Crawler coupé.',
    );
  });

  it('CATALOGUE_TEST reste distinct des catalogues réels', () => {
    expect([13, 79]).not.toContain(CATALOGUE_TEST);
  });
});

describe('frais fixes par run — comptés dans le budget (décision du 2026-11-04)', () => {
  const T0 = new Date('2026-11-10T05:00:00Z').getTime();
  const SEZANE: Cellule = cellule('Sweats et sweats à capuche (F)', 'Sézane', { catalogId: 13 });
  const suivie = (i: number) => ({
    id: `t${i}`,
    plateforme: 'VINTED' as const,
    externalId: `t${i}`,
    url: `https://www.vinted.fr/items/t${i}-x`,
    categorie: SEZANE.categorie,
    marque: 'Sézane',
    taille: null,
    prixInitialCents: 1000,
    prixCourantCents: 1000,
    etat: 'BON' as const,
    statut: 'ACTIVE' as const,
    premiereVuAt: new Date(T0 - 48 * 3600_000),
    derniereVuAt: new Date(T0 - 48 * 3600_000),
    derniereVerifAt: new Date(T0 - 48 * 3600_000),
    echecsConsecutifs: 0,
    soldAt: null,
    soldPrixCents: null,
    soldSource: null,
    catalogIdRecherche: 13,
    subcategoryId: 529,
    subcategoryLabel: "Pulls d'hiver",
  });

  it('ledger : coût d’un run = frais fixes + résultats × tarif', () => {
    const l = new BudgetLedger(budgetDepuisPlafond(10_000, 260, 5000));
    expect(l.costFor(0)).toBe(5000);
    expect(l.costFor(50)).toBe(5000 + 50 * 260);
    // Reliquat insuffisant pour les seuls frais fixes → aucun résultat finançable.
    const l2 = new BudgetLedger(budgetDepuisPlafond(10_000, 260, 5000), {
      suivi: 7996 * 1000,
      decouverte: 0,
    });
    expect(l2.affordableResultats('suivi')).toBe(0);
  });

  it('3 runs de 50 résultats à 2,60 $ / 1 000 + 0,05 $ par run = 54 c (et non 39 c)', async () => {
    const repo = new MemoryRepo();
    const source = new FakeSource();
    for (let i = 0; i < 150; i++) {
      const t = suivie(i);
      repo.state.tracked.set(t.id, t);
      source.monde.set(t.url, listing({ externalId: t.externalId, marque: 'Sézane' }));
    }
    await runSeed({
      campagne: 'frais',
      cellules: [{ ...SEZANE, cibleActives: 150 }], // parc complet : aucune découverte
      budget: budgetDepuisPlafond(10_000, 260, 5000),
      source,
      repo,
      tailleLotReverification: 50,
      now: () => new Date(T0),
    });
    expect(source.appels).toEqual([
      { type: 'recheck', taille: 50 },
      { type: 'recheck', taille: 50 },
      { type: 'recheck', taille: 50 },
    ]);
    expect(repo.spendLog.map((s) => s.milli)).toEqual([18_000, 18_000, 18_000]);
    expect(repo.totalSpent()).toBe(54 * 1000); // SeedRun : 54 c au total, frais inclus
  });

  it('runs sans résultat (frais fixes seuls) : l’arrêt dur à 80 € se déclenche, jamais dépassé', async () => {
    const repo = new MemoryRepo();
    for (let i = 0; i < 100; i++) {
      const t = suivie(i);
      repo.state.tracked.set(t.id, t);
    }
    // Source qui ne facture AUCUN résultat : seule la part fixe (1 € par run) est dépensée.
    const appels: number[] = [];
    const source = {
      async recheck(urls: readonly string[]) {
        appels.push(urls.length);
        return {
          results: urls.map((url) => ({
            url,
            outcome: 'active' as const,
            listing: listing({ externalId: url.split('/').pop() ?? 'x', marque: 'Sézane' }),
            payload: {},
          })),
          resultatsFactures: 0,
        };
      },
      async discover() {
        return { listings: [], resultatsFactures: 0 };
      },
    };
    const budget = budgetDepuisPlafond(10_000, 260, 100_000); // 1 € par run
    let clock = T0;
    let dernier;
    for (let jour = 0; jour < 20; jour++) {
      dernier = await runSeed({
        campagne: 'frais-fixes',
        cellules: [{ ...SEZANE, cibleActives: 100 }],
        budget,
        plafondCents: 10_000,
        source,
        repo,
        tailleLotReverification: 10,
        now: () => new Date(clock),
      });
      expect(repo.totalSpent()).toBeLessThanOrEqual(80 * EUR);
      if (dernier.statut === 'BUDGET_STOPPED') break;
      clock += 24 * 3600_000;
    }
    expect(dernier?.statut).toBe('BUDGET_STOPPED');
    // Chaque run réserve 1 € + 10 × 0,26 c : le 80e ne tient plus → 79 runs, 79,00 €.
    expect(appels).toHaveLength(79);
    expect(repo.totalSpent()).toBe(79 * EUR);
    expect(dernier?.alertes[0]).toMatch(/^ARRÊT DUR : Budget seed à 80 %/);
  });

  it('dry-run : frais fixes affichés et inclus dans le coût journalier', () => {
    const path = new URL('../fixtures/cellules-15-reference.json', import.meta.url).pathname;
    const plan = planSeedRun(readCellules(path), {
      plafondCents: 10_000,
      tarifs: [260],
      coutParRunMilli: 5000,
      batchSize: 50,
      maxDecouverteParCellule: 5,
    });
    // 12 lots de suivi + 15 découvertes = 27 runs par jour au plus.
    expect(plan.runsJourMax).toBe(27);
    expect(plan.tarifs[0]?.suiviJourMilli).toBe(600 * 260 + 12 * 5000);
    expect(formatSeedPlan(plan, 10_000, 'seed-2026-11')).toMatch(
      /Runs par jour : 27 au plus × 0,05 € de frais fixes = 1,35 € par jour/,
    );
  });
});

describe('dry-run : périmètre = cellules réellement crawlées', () => {
  it('test de pipeline (3 cellules secondary validées) : volumes sur ces 3 seules', () => {
    const reel = new URL('../../seed/cellules.json', import.meta.url).pathname;
    const plan = planSeedRun(readCellules(reel), {
      plafondCents: 1000,
      tarifs: [240],
      coutParRunMilli: 5000,
      batchSize: 100,
      maxDecouverteParCellule: 5,
    });
    expect(plan.projectionHypothetique).toBe(false);
    expect([plan.crawlables, plan.suiviJour, plan.lotsJour, plan.runsJourMax]).toEqual([
      3, 90, 1, 4,
    ]);
    const [t] = plan.tarifs;
    // Suivi : 90 × 0,24 c + 5 c = 26,6 c/j ; découverte : 15 × 0,24 c + 3 × 5 c = 18,6 c/j.
    expect([t?.suiviJourMilli, t?.decouverteJourMaxMilli]).toEqual([26_600, 18_600]);
    // Plafond 10 € → arrêt dur 8 €, découverte 1,20 € : épuisée le 7e jour (6 × 18,6 = 1,116 €).
    expect(t?.jourCoupureDecouverte).toBe(7);
    // Puis suivi seul : 1,20 € + 26 × 0,266 € ≥ 8 € → arrêt dur au jour 26, après les 15 j du test.
    expect(t?.jourArretDur).toBe(26);
  });
});
