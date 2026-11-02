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
    expect(budgetDepuisPlafond(10_000, 260)).toEqual({
      hardStopCents: 8000,
      suiviCents: 6800,
      decouverteCents: 1200,
      coutParResultatMilli: 260,
    });
  });

  it('les enveloppes tiennent dans l’arrêt dur (BudgetLedger les accepte)', () => {
    for (const plafond of [1, 99, 1200, 4800, 10_000, 12_345]) {
      const b = budgetDepuisPlafond(plafond, 260);
      expect(b.suiviCents + b.decouverteCents).toBe(b.hardStopCents);
      expect(() => new BudgetLedger(b)).not.toThrow();
    }
  });

  it('plafond invalide refusé', () => {
    expect(() => budgetDepuisPlafond(0, 260)).toThrow(RangeError);
    expect(() => budgetDepuisPlafond(10.5, 260)).toThrow(RangeError);
  });

  it('dépense bornée à 80,00 € : un appel qui ferait 80,01 € est refusé', () => {
    const l = new BudgetLedger(budgetDepuisPlafond(10_000, 1000)); // 1 c par résultat
    const r = l.reserve('suivi', 7999);
    if (typeof r === 'string') throw new Error('réservation refusée');
    l.commit(r, 7999);
    expect(l.reserve('suivi', 2)).toBe('budget_cap'); // 80,01 €
    expect(l.totalMilli).toBe(7999 * 1000);
    const l2 = new BudgetLedger(budgetDepuisPlafond(10_000, 1000));
    const r2 = l2.reserve('suivi', 8000);
    if (typeof r2 === 'string') throw new Error('réservation refusée');
    l2.commit(r2, 8000);
    expect(l2.totalMilli).toBe(80 * EUR);
    expect(l2.stopped).toBe(true);
  });

  it('découverte coupée à 12 € pendant que le suivi continue', () => {
    const l = new BudgetLedger(budgetDepuisPlafond(10_000, 1000));
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
  const path = new URL('../../seed/cellules.json', import.meta.url).pathname;

  it('cellules réelles : volumes par tier et coût maximal aux deux tarifs', () => {
    const plan = planSeedRun(readCellules(path), {
      plafondCents: 10_000,
      tarifs: [260, 357],
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
      batchSize: 50,
      maxDecouverteParCellule: 5,
    }).tarifs;
    // 600 × 1 c + min(75 c, 1 200 c) = 6,75 €/jour → 80 € atteints le 12e jour.
    expect(t?.jourArretDur).toBe(12);
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
      budget: budgetDepuisPlafond(10_000, 1000),
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
