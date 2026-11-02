/**
 * Saisie manuelle d'une dépense Apify passée hors CLI dans une campagne (hygiène comptable).
 * DRY-RUN PAR DÉFAUT : sans --execute, rien n'est écrit.
 *
 *   pnpm seed:backfill-verify --amount-cents 24 --note "tests acteurs A, A bis, 5 Sézane"
 *   pnpm seed:backfill-verify --execute --amount-cents 24 --note "…" [--campagne verify-2026-11]
 *
 * Seule DATABASE_URL est requise en --execute (aucun appel Apify, aucun token lu).
 */
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@margeo/db';
import { campagneDuMois, formatMilli, PrismaSeedRepository } from '../seed/index.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'amount-cents': { type: 'string' },
      note: { type: 'string' },
      campagne: { type: 'string' },
    },
  });
  const centimes = Number(values['amount-cents']);
  const note = values.note?.trim() ?? '';
  if (!Number.isInteger(centimes) || centimes <= 0 || note === '') {
    console.error('✖ --amount-cents (entier > 0, centimes d’euro) et --note sont obligatoires');
    return 2;
  }
  const campagne = values.campagne ?? campagneDuMois('verify', new Date());
  const resume = `${formatMilli(centimes * 1000)} dans ${campagne} (enveloppe découverte) — « ${note} »`;
  if (!values.execute) {
    console.log(`DRY-RUN, rien n'est écrit : saisirait ${resume}`);
    return 0;
  }
  const url = process.env['DATABASE_URL'];
  if (!url?.trim()) {
    console.error('✖ DATABASE_URL manquant');
    return 2;
  }
  const prisma = createPrismaClient(url);
  try {
    const id = await new PrismaSeedRepository(prisma).recordBackfill(
      campagne,
      centimes,
      note,
      new Date(),
    );
    console.log(`✔ Saisi : ${resume} (SeedRun ${id})`);
    return 0;
  } catch (err) {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
