import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createPrismaClient, type PrismaClient } from '@margeo/db';
import {
  BrandResolver,
  PrismaSeedRepository,
  runSeed,
  type BudgetConfig,
  type SeedTx,
} from '../../src/seed/index.js';
import { ALIAS_VALIDES, NON_RATTACHES } from './alias-reference.js';
import { cellule, FakeSource, listing, SOUS_CATEGORIE_TEST } from './fake-source.js';

/** Intégration sur Postgres réel : base temporaire migrée par `prisma migrate deploy`. */
const DATABASE_URL = process.env['DATABASE_URL'];
const DB_PKG = fileURLToPath(new URL('../../../db', import.meta.url));
const BUDGET: BudgetConfig = {
  hardStopCents: 4800,
  suiviCents: 3000,
  decouverteCents: 1800,
  coutParResultatMilli: 1000,
  coutParRunMilli: 0, // frais par run testés dans decisions-2b.test.ts
};
const H = 60 * 60 * 1000;

describe.skipIf(!DATABASE_URL)('PrismaSeedRepository — Postgres réel', () => {
  const name = `margeo_seedtest_${randomBytes(4).toString('hex')}`;
  let admin: pg.Client;
  let prisma: PrismaClient;
  let clock = new Date('2026-11-10T05:00:00Z').getTime();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const u = new URL(DATABASE_URL ?? '');
    u.pathname = `/${name}`;
    const deploy = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: DB_PKG,
      env: { ...process.env, DATABASE_URL: u.toString() },
      encoding: 'utf8',
    });
    if (deploy.status !== 0) throw new Error(deploy.stderr + deploy.stdout);
    prisma = createPrismaClient(u.toString());
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  });

  const cellules = [cellule('Baskets', 'Nike')];

  it('alias de marques migrés = référence validée de la section 7, ambigus non rattachés', async () => {
    const rows = await new PrismaSeedRepository(prisma).loadBrandAliases();
    const parAlias = (a: { alias: string }, b: { alias: string }) =>
      a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
    const attendu = Object.entries(ALIAS_VALIDES).flatMap(([marque, aliases]) =>
      aliases.map((alias) => ({ alias, marque, valide: true })),
    );
    expect([...rows].sort(parAlias)).toEqual(attendu.sort(parAlias));
    const r = new BrandResolver(Object.keys(ALIAS_VALIDES), rows);
    for (const texte of NON_RATTACHES) expect(r.resolve(texte)).toBeNull();
  });

  it('cycle complet : découverte, vente, projection, dépense persistée par run', async () => {
    const source = new FakeSource();
    const repo = new PrismaSeedRepository(prisma);
    source.catalogue.set('Baskets|Nike', [
      listing({ externalId: 'p1' }),
      listing({ externalId: 'p2' }),
    ]);
    const r1 = await runSeed({
      campagne: 'integ',
      cellules,
      budget: BUDGET,
      source,
      repo,
      now: () => new Date(clock),
    });
    expect(r1).toMatchObject({ statut: 'COMPLETED', nouvellesAnnonces: 2 });

    source.catalogue.clear();
    source.monde.set(
      'https://www.vinted.fr/items/p1-x',
      listing({ externalId: 'p1', statut: 'sold', prixCents: 3500 }),
    );
    source.monde.set(
      'https://www.vinted.fr/items/p2-x',
      listing({ externalId: 'p2', prixCents: 3900 }),
    );
    clock += 24 * H;
    const r2 = await runSeed({
      campagne: 'integ',
      cellules,
      budget: BUDGET,
      source,
      repo,
      now: () => new Date(clock),
    });
    expect(r2.ventesDetectees).toBe(1);

    const p1 = await prisma.trackedListing.findUniqueOrThrow({
      where: { plateforme_externalId: { plateforme: 'VINTED', externalId: 'p1' } },
      include: { vente: true, observations: true },
    });
    expect(p1).toMatchObject({ statut: 'SOLD', soldPrixCents: 3500, soldSource: 'sold_status' });
    expect(p1.vente).toMatchObject({
      prixVenteCents: 3500,
      source: 'sold_status',
      externalId: 'p1',
    });
    expect(p1.observations).toHaveLength(2);
    expect(p1).toMatchObject({
      catalogIdRecherche: 100,
      subcategoryId: SOUS_CATEGORIE_TEST,
      subcategoryLabel: 'Baskets',
    });
    expect(
      await prisma.subcategoryToParent.findUnique({
        where: { subcategoryId: SOUS_CATEGORIE_TEST },
      }),
    ).toEqual({
      subcategoryId: SOUS_CATEGORIE_TEST,
      parentId: 100,
      libelle: 'Baskets',
      verifie: false,
    });

    const runs = await prisma.seedRun.findMany({
      where: { campagne: 'integ' },
      orderBy: { startedAt: 'asc' },
    });
    expect(runs.map((r) => r.statut)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(runs[0]).toMatchObject({ coutDecouverteMilliCents: 2000, resultatsFactures: 2 });
    expect(runs[1]).toMatchObject({ coutSuiviMilliCents: 2000 });
    expect(await repo.campaignSpent('integ')).toEqual({ suivi: 2000, decouverte: 2000 });
  });

  it('rollback réel : une erreur au milieu d’une annonce n’écrit rien pour elle', async () => {
    const base = new PrismaSeedRepository(prisma);
    // Dépôt dont la projection de vente échoue pour « q1 », APRÈS la mise à jour du statut.
    const repo = Object.create(base) as PrismaSeedRepository;
    repo.transaction = <T>(fn: (tx: SeedTx) => Promise<T>) =>
      base.transaction((tx) =>
        fn({
          ...tx,
          writeSoldProjection: async (s) => {
            if (s.externalId === 'q1') throw new Error('panne simulée');
            return tx.writeSoldProjection(s);
          },
        }),
      );
    const source = new FakeSource();
    source.catalogue.set('Baskets|Nike', [
      listing({ externalId: 'q1' }),
      listing({ externalId: 'q2' }),
    ]);
    await runSeed({
      campagne: 'rollback',
      cellules,
      budget: BUDGET,
      source,
      repo,
      now: () => new Date(clock),
    });
    source.catalogue.clear();
    source.monde.set(
      'https://www.vinted.fr/items/q1-x',
      listing({ externalId: 'q1', statut: 'sold' }),
    );
    source.monde.set(
      'https://www.vinted.fr/items/q2-x',
      listing({ externalId: 'q2', statut: 'sold' }),
    );
    clock += 24 * H;
    const r = await runSeed({
      campagne: 'rollback',
      cellules,
      budget: BUDGET,
      source,
      repo,
      now: () => new Date(clock),
    });
    expect(r).toMatchObject({ statut: 'PARTIAL', erreurs: 1 });

    const q1 = await prisma.trackedListing.findUniqueOrThrow({
      where: { plateforme_externalId: { plateforme: 'VINTED', externalId: 'q1' } },
      include: { vente: true, observations: true },
    });
    expect(q1).toMatchObject({ statut: 'ACTIVE', soldAt: null });
    expect(q1.vente).toBeNull();
    expect(q1.observations).toHaveLength(1);
    const q2 = await prisma.trackedListing.findUniqueOrThrow({
      where: { plateforme_externalId: { plateforme: 'VINTED', externalId: 'q2' } },
      include: { vente: true },
    });
    expect(q2.statut).toBe('SOLD');
    expect(q2.vente).not.toBeNull();
  });

  it('SubcategoryToParent : jamais écrasée, parents lus en lot', async () => {
    const repo = new PrismaSeedRepository(prisma);
    await repo.transaction((tx) =>
      tx.recordSubcategory({ subcategoryId: 9001, parentId: 13, libelle: 'Cardigans' }),
    );
    await repo.transaction((tx) =>
      tx.recordSubcategory({ subcategoryId: 9001, parentId: 79, libelle: 'Autre' }),
    );
    expect(await repo.subcategoryParents([9001, 9002])).toEqual(new Map([[9001, 13]]));
    expect(await repo.subcategoryParents([])).toEqual(new Map());
  });

  it('re-vérification : les annonces hors seed (catalogIdRecherche NULL) ne sont pas listées', async () => {
    await prisma.trackedListing.create({
      data: {
        externalId: 'hors-seed',
        url: 'https://www.vinted.fr/items/hors-seed-x',
        categorie: 'Baskets',
        marque: 'Nike',
        prixInitialCents: 1,
        prixCourantCents: 1,
        etat: 'BON',
        premiereVuAt: new Date(0),
        derniereVuAt: new Date(0),
        derniereVerifAt: new Date(0),
      },
    });
    const liste = await new PrismaSeedRepository(prisma).listToRecheck(new Date(clock), 1000);
    expect(liste.map((t) => t.externalId)).not.toContain('hors-seed');
    expect(liste.every((t) => t.catalogIdRecherche !== null)).toBe(true);
    expect(await new PrismaSeedRepository(prisma).countNonRattachees()).toBe(1);
  });

  it('backfill : dépense saisie comptée dans la campagne, double saisie refusée', async () => {
    const repo = new PrismaSeedRepository(prisma);
    const at = new Date('2026-11-04T13:00:00Z');
    await repo.recordBackfill('verify-backfill', 24, 'tests acteurs A, A bis, 5 Sézane', at);
    expect(await repo.campaignSpent('verify-backfill')).toEqual({ suivi: 0, decouverte: 24_000 });
    await expect(
      repo.recordBackfill('verify-backfill', 24, 'tests acteurs A, A bis, 5 Sézane', at),
    ).rejects.toThrow(/déjà saisie/);
    await expect(repo.recordBackfill('verify-backfill', 0, 'x', at)).rejects.toThrow(RangeError);
    expect(await repo.campaignSpent('verify-backfill')).toEqual({ suivi: 0, decouverte: 24_000 });
  });

  it('repli des lots : drapeau de timeout lu sur le dernier run terminé de la campagne', async () => {
    const repo = new PrismaSeedRepository(prisma);
    expect(await repo.dernierRecheckEnTimeout('lots-integ')).toBe(false);
    const mk = (startedAt: string, recheckTimeout: boolean, fini = true) =>
      prisma.seedRun.create({
        data: {
          campagne: 'lots-integ',
          budgetMaxCents: 8000,
          startedAt: new Date(startedAt),
          finishedAt: fini ? new Date(startedAt) : null,
          details: { recheckTimeout },
        },
      });
    await mk('2026-11-10T05:00:00Z', true);
    expect(await repo.dernierRecheckEnTimeout('lots-integ')).toBe(true);
    await mk('2026-11-11T05:00:00Z', false);
    expect(await repo.dernierRecheckEnTimeout('lots-integ')).toBe(false);
    await mk('2026-11-12T05:00:00Z', true, false); // run en cours : ignoré
    expect(await repo.dernierRecheckEnTimeout('lots-integ')).toBe(false);
  });

  it('hard stop persistant : une campagne à 48 € ne lance plus aucun appel', async () => {
    await prisma.seedRun.create({
      data: {
        campagne: 'pleine',
        budgetMaxCents: 4800,
        coutSuiviMilliCents: 3_000_000,
        coutDecouverteMilliCents: 1_800_000,
        statut: 'BUDGET_STOPPED',
      },
    });
    const source = new FakeSource();
    source.catalogue.set('Baskets|Nike', [listing({ externalId: 'z' })]);
    const r = await runSeed({
      campagne: 'pleine',
      cellules,
      budget: BUDGET,
      source,
      repo: new PrismaSeedRepository(prisma),
      now: () => new Date(clock),
    });
    expect(source.appels).toHaveLength(0);
    expect(r.statut).toBe('BUDGET_STOPPED');
  });
});
