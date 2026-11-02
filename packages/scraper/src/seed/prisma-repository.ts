import type { Prisma, PrismaClient } from '@margeo/db';
import type {
  Cellule,
  NewTracked,
  ObservationInput,
  SeedRepository,
  SeedRunSummary,
  SeedTx,
  SoldProjection,
  TrackedState,
} from './types.js';

type Tx = Prisma.TransactionClient;

interface TrackedRow extends Omit<TrackedState, 'plateforme'> {
  plateforme: string;
}

function toState(row: TrackedRow): TrackedState {
  return { ...row, plateforme: 'VINTED' };
}

function txAdapter(tx: Tx): SeedTx {
  return {
    async createTracked(t: NewTracked) {
      return toState(await tx.trackedListing.create({ data: t }));
    },
    async updateTracked(id, patch) {
      await tx.trackedListing.update({ where: { id }, data: patch });
    },
    async appendObservation(o: ObservationInput) {
      await tx.listingObservation.create({
        data: { ...o, payload: (o.payload ?? {}) as Prisma.InputJsonValue },
      });
    },
    async writeSoldProjection(s: SoldProjection) {
      const { trackedListingId, ...data } = s;
      await tx.soldObservation.upsert({
        where: { trackedListingId },
        create: { ...data, plateforme: 'VINTED', trackedListingId },
        update: data,
      });
    },
  };
}

/** Implémentation Prisma du dépôt de seed. Chaque `transaction` est une transaction Postgres. */
export class PrismaSeedRepository implements SeedRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async loadBrandAliases() {
    return this.prisma.brandAlias.findMany({
      select: { alias: true, marque: true, valide: true },
      orderBy: { alias: 'asc' },
    });
  }

  async campaignSpent(campagne: string) {
    const agg = await this.prisma.seedRun.aggregate({
      where: { campagne },
      _sum: { coutSuiviMilliCents: true, coutDecouverteMilliCents: true },
    });
    return {
      suivi: agg._sum.coutSuiviMilliCents ?? 0,
      decouverte: agg._sum.coutDecouverteMilliCents ?? 0,
    };
  }

  async startRun(campagne: string, budgetMaxCents: number, startedAt: Date) {
    const run = await this.prisma.seedRun.create({ data: { campagne, budgetMaxCents, startedAt } });
    return run.id;
  }

  async recordSpend(
    runId: string,
    envelope: 'suivi' | 'decouverte',
    milli: number,
    resultatsFactures: number,
  ) {
    // Incrément atomique côté base : pas de lecture-écriture concurrente à perdre.
    await this.prisma.seedRun.update({
      where: { id: runId },
      data: {
        resultatsFactures: { increment: resultatsFactures },
        ...(envelope === 'suivi'
          ? { coutSuiviMilliCents: { increment: milli } }
          : { coutDecouverteMilliCents: { increment: milli } }),
      },
    });
  }

  async finishRun(runId: string, s: SeedRunSummary, finishedAt: Date) {
    await this.prisma.seedRun.update({
      where: { id: runId },
      data: {
        statut: s.statut,
        finishedAt,
        annoncesVerifiees: s.annoncesVerifiees,
        nouvellesAnnonces: s.nouvellesAnnonces,
        ventesDetectees: s.ventesDetectees,
        disparitions: s.disparitions,
        erreurs: s.erreurs,
        details: s.details as Prisma.InputJsonValue,
      },
    });
  }

  async listToRecheck(before: Date, limit: number) {
    const rows = await this.prisma.trackedListing.findMany({
      where: { statut: 'ACTIVE', derniereVerifAt: { lt: before } },
      orderBy: { derniereVerifAt: 'asc' },
      take: limit,
    });
    return rows.map(toState);
  }

  async countActive(cellule: Cellule) {
    // Comparaison insensible à la casse, comme matchesCellule.
    return this.prisma.trackedListing.count({
      where: {
        statut: 'ACTIVE',
        categorie: { equals: cellule.categorie, mode: 'insensitive' },
        marque: { equals: cellule.marque, mode: 'insensitive' },
        ...(cellule.taille === null
          ? {}
          : { taille: { equals: cellule.taille, mode: 'insensitive' } }),
      },
    });
  }

  async trackedExternalIds(externalIds: readonly string[]) {
    if (externalIds.length === 0) return new Set<string>();
    const rows = await this.prisma.trackedListing.findMany({
      where: { plateforme: 'VINTED', externalId: { in: [...externalIds] } },
      select: { externalId: true },
    });
    return new Set(rows.map((r) => r.externalId));
  }

  transaction<T>(fn: (tx: SeedTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(txAdapter(tx)));
  }
}
