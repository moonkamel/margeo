/**
 * Exécution quotidienne du crawl de seed (GitHub Actions).
 *
 *   pnpm seed:run --budget-max 4800 --cout-par-1000 <centimes EUR> [--cellule "Baskets|Nike"]
 *
 * Codes de sortie : 0 OK · 1 erreur · 2 configuration manquante · 3 ARRÊT DUR budgétaire.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@margeo/db';
import { ApifyDriver } from '../drivers/apify.js';
import {
  ApifySeedSource,
  formatMilli,
  loadCellules,
  PrismaSeedRepository,
  requireSeedEnv,
  runSeed,
  SeedConfigError,
} from '../seed/index.js';

const intArg = (name: string, v: string | undefined, def?: number): number => {
  const n = v === undefined ? def : Number(v);
  if (n === undefined || !Number.isInteger(n) || n < 0)
    throw new SeedConfigError(`--${name} doit être un entier positif`);
  return n;
};

const ghEscape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'budget-max': { type: 'string' },
      'budget-suivi': { type: 'string' },
      'budget-decouverte': { type: 'string' },
      'cout-par-1000': { type: 'string' },
      cellules: { type: 'string', default: 'seed/cellules.json' },
      cellule: { type: 'string' },
      campagne: { type: 'string' },
      batch: { type: 'string' },
      'max-decouverte': { type: 'string' },
      'cible-actives': { type: 'string' },
      'log-file': { type: 'string' },
    },
  });

  const logFile = values['log-file'];
  const log = (event: string, data: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
    console.log(line);
    if (logFile) appendFileSync(logFile, `${line}\n`);
  };

  let env;
  let cellules;
  let budget;
  try {
    env = requireSeedEnv(process.env);
    const hardStopCents = intArg('budget-max', values['budget-max']);
    const coutParResultatMilli = intArg(
      'cout-par-1000',
      values['cout-par-1000'] ?? process.env['SEED_COUT_PAR_1000_CENTS'],
    );
    if (coutParResultatMilli === 0)
      throw new SeedConfigError('--cout-par-1000 doit être > 0 (tarif réel de l’acteur)');
    budget = {
      hardStopCents,
      suiviCents: intArg('budget-suivi', values['budget-suivi'], 3000),
      decouverteCents: intArg('budget-decouverte', values['budget-decouverte'], 1800),
      coutParResultatMilli,
    };
    cellules = loadCellules(values.cellules ?? 'seed/cellules.json', values.cellule);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✖ Configuration du seed incomplète :\n${msg}`);
    for (const line of msg.split('\n'))
      console.log(`::error title=Seed non configuré::${ghEscape(line)}`);
    return 2;
  }

  const prisma = createPrismaClient(env.databaseUrl);
  try {
    const driver = new ApifyDriver({
      actorId: env.apifyActorId,
      token: env.apifyToken,
      timeoutSecs: 280,
    });
    const result = await runSeed({
      campagne: values.campagne ?? process.env['SEED_CAMPAIGN'] ?? 'seed-2026-11',
      cellules,
      budget,
      source: new ApifySeedSource(driver),
      repo: new PrismaSeedRepository(prisma),
      log,
      batchSize: intArg('batch', values.batch, 50),
      maxDecouverteParCellule: intArg('max-decouverte', values['max-decouverte'], 5),
      cibleActivesParCellule: intArg('cible-actives', values['cible-actives'], 20),
    });

    const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
    if (summaryFile) {
      appendFileSync(
        summaryFile,
        [
          `## Seed — ${result.statut}`,
          '',
          `| Dépense du run | Dépense campagne | Plafond |`,
          `|---|---|---|`,
          `| ${formatMilli(result.depenseRunMilli)} | ${formatMilli(result.depenseCampagneMilli)} | ${formatMilli(result.plafondMilli)} |`,
          '',
          `Vérifiées : ${result.annoncesVerifiees} · Nouvelles : ${result.nouvellesAnnonces} · Ventes : ${result.ventesDetectees} · Disparitions : ${result.disparitions} · Erreurs : ${result.erreurs}`,
          '',
          ...result.alertes.map((a) => `> ⚠️ ${a}`),
          '',
        ].join('\n'),
      );
    }
    for (const a of result.alertes) {
      console.log(
        `${a.startsWith('ARRÊT DUR') ? '::error title=Budget seed' : '::warning title=Seed'}::${ghEscape(a)}`,
      );
    }
    return result.statut === 'BUDGET_STOPPED' ? 3 : 0;
  } catch (err) {
    log('seed.fatal', { error: String(err) });
    console.log(`::error title=Seed en échec::${ghEscape(String(err))}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
