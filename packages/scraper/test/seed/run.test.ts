import { beforeEach, describe, expect, it } from 'vitest';
import {
  runSeed,
  type BudgetConfig,
  type Cellule,
  type RunSeedOptions,
} from '../../src/seed/index.js';
import { cellule, FakeSource, listing } from './fake-source.js';
import { MemoryRepo } from './memory-repo.js';

const H = 60 * 60 * 1000;
const T0 = new Date('2026-11-10T05:00:00Z').getTime();
const CELLULES: Cellule[] = [cellule('Baskets', 'Nike'), cellule('Baskets', 'Adidas')];
const BUDGET: BudgetConfig = {
  hardStopCents: 4800,
  suiviCents: 3000,
  decouverteCents: 1800,
  coutParResultatMilli: 1000,
};

let source: FakeSource;
let repo: MemoryRepo;
let clock: number;

beforeEach(() => {
  source = new FakeSource();
  repo = new MemoryRepo();
  clock = T0;
});

/** `cible` : parc cible appliqué à toutes les cellules du run. */
const run = ({ cible, ...o }: Partial<RunSeedOptions> & { cible?: number } = {}) =>
  runSeed({
    campagne: 'test',
    budget: BUDGET,
    source,
    repo,
    now: () => new Date(clock),
    ...o,
    cellules: (o.cellules ?? CELLULES).map((c) =>
      cible === undefined ? c : { ...c, cibleActives: cible },
    ),
  });

/** Avance l'horloge d'un jour. */
const jourSuivant = () => {
  clock += 24 * H;
};

describe('runSeed — découverte', () => {
  it('suit jusqu’à 5 nouvelles annonces par cellule, première observation incluse', async () => {
    source.catalogue.set(
      'Baskets|Nike',
      Array.from({ length: 8 }, (_, i) => listing({ externalId: `n${i}` })),
    );
    const r = await run();
    expect(r.nouvellesAnnonces).toBe(5);
    expect(source.appels.filter((a) => a.type === 'discover').map((a) => a.taille)).toEqual([5, 5]);
    expect(repo.state.observations).toHaveLength(5);
    expect(repo.byExternalId('n0')).toMatchObject({
      statut: 'ACTIVE',
      prixInitialCents: 4000,
      prixCourantCents: 4000,
    });
    expect(r.statut).toBe('COMPLETED');
  });

  it('filtre la cellule exacte (non-régression du mélange de marques), les vendues et les déjà suivies', async () => {
    source.catalogue.set('Baskets|Nike', [
      listing({ externalId: 'ok' }),
      listing({ externalId: 'puma', marque: 'Puma' }),
      listing({ externalId: 'vendue', statut: 'sold' }),
      listing({ externalId: 'ok' }), // doublon dans la même réponse
    ]);
    await run();
    expect([...repo.state.tracked.values()].map((t) => t.externalId)).toEqual(['ok']);
    jourSuivant();
    await run();
    expect(repo.state.tracked.size).toBe(1); // déjà suivie : pas recréée
  });
});

describe('runSeed — parc cible par cellule', () => {
  it('complète jusqu’à la cible puis arrête la découverte (coût de suivi borné)', async () => {
    source.catalogue.set(
      'Baskets|Nike',
      Array.from({ length: 40 }, (_, i) => listing({ externalId: `n${i}` })),
    );
    const cellules = [CELLULES[0] as Cellule];
    for (let jour = 0; jour < 6; jour++) {
      for (const t of repo.state.tracked.values())
        source.monde.set(t.url, listing({ externalId: t.externalId }));
      for (const [k, v] of source.catalogue)
        source.catalogue.set(
          k,
          v.filter((l) => !repo.byExternalId(l.externalId)),
        );
      await run({ cellules, cible: 12 });
      jourSuivant();
    }
    // 5 + 5 + 2 puis plus rien : parc plafonné à 12.
    expect(repo.state.tracked.size).toBe(12);
    const decouvertes = source.appels.filter((a) => a.type === 'discover').map((a) => a.taille);
    expect(decouvertes).toEqual([5, 5, 2]);
  });

  it('une vente libère une place, comblée le lendemain', async () => {
    source.catalogue.set(
      'Baskets|Nike',
      Array.from({ length: 10 }, (_, i) => listing({ externalId: `n${i}` })),
    );
    const cellules = [CELLULES[0] as Cellule];
    await run({ cellules, cible: 3 });
    for (const [k, v] of source.catalogue)
      source.catalogue.set(
        k,
        v.filter((l) => !repo.byExternalId(l.externalId)),
      );
    for (const t of repo.state.tracked.values())
      source.monde.set(t.url, listing({ externalId: t.externalId }));
    source.monde.set(
      'https://www.vinted.fr/items/n0-x',
      listing({ externalId: 'n0', statut: 'sold' }),
    );
    jourSuivant();
    source.appels.length = 0;
    const r = await run({ cellules, cible: 3 });
    expect(r.ventesDetectees).toBe(1);
    expect(source.appels.find((a) => a.type === 'discover')?.taille).toBe(1);
    expect(r.nouvellesAnnonces).toBe(1);
  });
});

describe('runSeed — re-vérification', () => {
  beforeEach(async () => {
    source.catalogue.set('Baskets|Nike', [
      listing({ externalId: 'a', prixCents: 5000 }),
      listing({ externalId: 'b' }),
      listing({ externalId: 'c' }),
      listing({ externalId: 'd' }),
    ]);
    await run();
    source.catalogue.clear();
    for (const t of repo.state.tracked.values())
      source.monde.set(t.url, listing({ externalId: t.externalId, prixCents: t.prixCourantCents }));
  });

  it('active : prix courant mis à jour, snapshot ajouté au journal', async () => {
    source.monde.set(
      'https://www.vinted.fr/items/a-x',
      listing({ externalId: 'a', prixCents: 4500 }),
    );
    jourSuivant();
    await run();
    expect(repo.byExternalId('a')).toMatchObject({
      prixInitialCents: 5000,
      prixCourantCents: 4500,
      echecsConsecutifs: 0,
    });
    expect(repo.state.observations.filter((o) => o.prixCents === 4500)).toHaveLength(1);
  });

  it('vendue : TrackedListing SOLD et projection SoldObservation cohérente', async () => {
    source.monde.set(
      'https://www.vinted.fr/items/b-x',
      listing({ externalId: 'b', statut: 'sold', prixCents: 3800 }),
    );
    jourSuivant();
    const r = await run();
    expect(r.ventesDetectees).toBe(1);
    expect(r.details['cellules']).toMatchObject({ '100|Nike|*': { ventes: 1, vues: 3 } });
    const t = repo.byExternalId('b');
    expect(t).toMatchObject({ statut: 'SOLD', soldPrixCents: 3800, soldSource: 'sold_status' });
    expect(repo.state.ventes.get(t?.id ?? '')).toMatchObject({
      prixVenteCents: 3800,
      source: 'sold_status',
      listedAt: new Date(T0),
    });
  });

  it('introuvable 2 fois à 24 h d’écart → DISAPPEARED (signal faible), projection « disappeared »', async () => {
    source.monde.delete('https://www.vinted.fr/items/c-x');
    jourSuivant();
    await run();
    expect(repo.byExternalId('c')).toMatchObject({ statut: 'ACTIVE', echecsConsecutifs: 1 });
    jourSuivant();
    const r = await run();
    expect(r.disparitions).toBe(1);
    const t = repo.byExternalId('c');
    expect(t).toMatchObject({
      statut: 'DISAPPEARED',
      soldSource: 'disappeared',
      echecsConsecutifs: 2,
    });
    expect(t?.soldAt).toEqual(new Date(T0 + 24 * H)); // premier échec
    expect(repo.state.ventes.get(t?.id ?? '')?.source).toBe('disappeared');
  });

  it('clôturée sans vente → CLOSED, plus re-vérifiée', async () => {
    source.monde.set('https://www.vinted.fr/items/d-x', 'closed');
    jourSuivant();
    await run();
    expect(repo.byExternalId('d')?.statut).toBe('CLOSED');
    jourSuivant();
    source.appels.length = 0;
    await run();
    expect(source.appels.find((a) => a.type === 'recheck')?.taille).toBe(3);
  });

  it('payload illisible → erreur comptée, aucune transition', async () => {
    source.monde.set('https://www.vinted.fr/items/a-x', 'illisible');
    jourSuivant();
    const r = await run();
    expect(r.erreurs).toBe(1);
    expect(r.statut).toBe('PARTIAL');
    expect(repo.byExternalId('a')?.derniereVerifAt).toEqual(new Date(T0));
  });

  it('une annonce vérifiée il y a moins de 20 h n’est pas re-vérifiée', async () => {
    clock += 2 * H;
    source.appels.length = 0;
    await run();
    expect(source.appels.some((a) => a.type === 'recheck')).toBe(false);
  });

  it('lots de taille bornée', async () => {
    jourSuivant();
    source.appels.length = 0;
    await run({ batchSize: 3 });
    expect(source.appels.filter((a) => a.type === 'recheck').map((a) => a.taille)).toEqual([3, 1]);
  });
});

describe('runSeed — rollback en cas d’erreur partielle', () => {
  it('échec d’écriture au milieu d’une annonce : rien n’est conservé pour elle, les autres passent', async () => {
    source.catalogue.set('Baskets|Nike', [
      listing({ externalId: 'a' }),
      listing({ externalId: 'b' }),
    ]);
    await run();
    source.catalogue.clear();
    source.monde.set(
      'https://www.vinted.fr/items/a-x',
      listing({ externalId: 'a', statut: 'sold', prixCents: 3000 }),
    );
    source.monde.set(
      'https://www.vinted.fr/items/b-x',
      listing({ externalId: 'b', statut: 'sold', prixCents: 3100 }),
    );
    // Panne sur la projection de la vente de « a » : la mise à jour SOLD de « a » doit être annulée.
    repo.failWrite = (op, arg) => {
      if (op === 'writeSoldProjection' && (arg as { externalId: string }).externalId === 'a')
        throw new Error('disque plein');
    };
    jourSuivant();
    const r = await run();
    expect(repo.byExternalId('a')).toMatchObject({
      statut: 'ACTIVE',
      soldAt: null,
      prixCourantCents: 4000,
    });
    expect(repo.state.ventes.size).toBe(1);
    expect(repo.byExternalId('b')?.statut).toBe('SOLD');
    expect(r).toMatchObject({ statut: 'PARTIAL', erreurs: 1, ventesDetectees: 1 });
    // Pas d'observation orpheline pour « a » au-delà de la première.
    const idA = repo.byExternalId('a')?.id;
    expect(repo.state.observations.filter((o) => o.trackedListingId === idA)).toHaveLength(1);
  });

  it('échec d’un appel source : coût maximal compté prudemment, le run continue', async () => {
    source.failNext = new Error('Apify 502');
    source.catalogue.set('Baskets|Adidas', [listing({ externalId: 'x', marque: 'Adidas' })]);
    const r = await run();
    expect(r.erreurs).toBe(1);
    expect(repo.spendLog[0]).toEqual({ envelope: 'decouverte', milli: 5000 }); // 5 résultats max × 1 c
    expect(r.nouvellesAnnonces).toBe(1); // la cellule suivante a été traitée
  });

  it('erreur inattendue (base) : run FAILED, dépense déjà engagée conservée, erreur remontée', async () => {
    repo.failListToRecheck = true;
    await expect(run()).rejects.toThrow('base indisponible');
    expect(repo.runs[0]?.summary?.statut).toBe('FAILED');
  });
});

describe('runSeed — hard stop budgétaire', () => {
  it('campagne déjà à 48 € : aucun appel, BUDGET_STOPPED et alerte', async () => {
    repo = new MemoryRepo({ suivi: 3000 * 1000, decouverte: 1800 * 1000 });
    source.catalogue.set('Baskets|Nike', [listing({ externalId: 'n' })]);
    const r = await run();
    expect(source.appels).toHaveLength(0);
    expect(r.statut).toBe('BUDGET_STOPPED');
    expect(r.alertes[0]).toMatch(/ARRÊT DUR.*48,00 €/);
  });

  it('se déclenche à 48,00 € et pas à 48,01 € sur une campagne de plusieurs jours', async () => {
    // Tarif volontairement élevé (1 €/résultat) pour atteindre le plafond en quelques jours.
    const budget: BudgetConfig = { ...BUDGET, coutParResultatMilli: 100_000 };
    source.catalogue.set(
      'Baskets|Nike',
      Array.from({ length: 60 }, (_, i) => listing({ externalId: `n${i}` })),
    );
    source.catalogue.set(
      'Baskets|Adidas',
      Array.from({ length: 60 }, (_, i) => listing({ externalId: `a${i}`, marque: 'Adidas' })),
    );
    let dernier;
    for (let jour = 0; jour < 30; jour++) {
      for (const t of repo.state.tracked.values())
        source.monde.set(t.url, listing({ externalId: t.externalId, marque: t.marque ?? 'Nike' }));
      // Les annonces découvertes sont retirées du catalogue pour en découvrir de nouvelles chaque jour.
      for (const [k, v] of source.catalogue)
        source.catalogue.set(
          k,
          v.filter((l) => !repo.byExternalId(l.externalId)),
        );
      dernier = await run({ budget, cible: 1000 });
      expect(repo.totalSpent()).toBeLessThanOrEqual(4800 * 1000);
      if (dernier.statut === 'BUDGET_STOPPED') break;
      jourSuivant();
    }
    expect(dernier?.statut).toBe('BUDGET_STOPPED');
    expect(repo.totalSpent()).toBe(4800 * 1000); // pile 48,00 €
    expect(dernier?.alertes[0]).toMatch(/ARRÊT DUR/);
    // Le lendemain : plus aucun appel.
    jourSuivant();
    source.appels.length = 0;
    const apres = await run({ budget, cible: 1000 });
    expect(source.appels).toHaveLength(0);
    expect(apres.statut).toBe('BUDGET_STOPPED');
    expect(repo.totalSpent()).toBe(4800 * 1000);
  });

  it('la dépense est persistée après chaque appel, pas seulement en fin de run', async () => {
    source.catalogue.set('Baskets|Nike', [listing({ externalId: 'n' })]);
    source.catalogue.set('Baskets|Adidas', [listing({ externalId: 'a', marque: 'Adidas' })]);
    await run();
    expect(repo.spendLog).toEqual([
      { envelope: 'decouverte', milli: 1000 },
      { envelope: 'decouverte', milli: 1000 },
    ]);
  });

  it('surfacturation de la source : alerte d’anomalie', async () => {
    source.surfacturation = 10;
    source.catalogue.set('Baskets|Nike', [listing({ externalId: 'n' })]);
    const r = await run({ cellules: [CELLULES[0] as Cellule] });
    expect(r.alertes.some((a) => a.includes('Anomalie de facturation'))).toBe(true);
  });

  it('enveloppe découverte pleine : découverte coupée, suivi maintenu', async () => {
    repo = new MemoryRepo({ suivi: 0, decouverte: 1800 * 1000 });
    const r = await run();
    expect(source.appels.some((a) => a.type === 'discover')).toBe(false);
    expect(r.statut).toBe('COMPLETED');
    expect(r.alertes.some((a) => a.startsWith('Découverte coupée'))).toBe(true);
  });
});
