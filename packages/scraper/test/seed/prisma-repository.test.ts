import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createPrismaClient, type PrismaClient } from '@margeo/db';
import {
  PrismaSeedRepository,
  runSeed,
  type BudgetConfig,
  type SeedTx,
} from '../../src/seed/index.js';
import { FakeSource, listing } from './fake-source.js';

/** Intégration sur Postgres réel : base temporaire migrée par `prisma migrate deploy`. */
const DATABASE_URL = process.env['DATABASE_URL'];
const DB_PKG = fileURLToPath(new URL('../../../db', import.meta.url));
const BUDGET: BudgetConfig = {
  hardStopCents: 4800,
  suiviCents: 3000,
  decouverteCents: 1800,
  coutParResultatMilli: 1000,
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

  const cellules = [{ categorie: 'Baskets', marque: 'Nike', taille: null }];

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
