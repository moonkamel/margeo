/**
 * Crawl de seed (GitHub Actions). DRY-RUN PAR DÉFAUT : sans --execute, aucun appel Apify,
 * aucune base, aucun token lu — affichage des cellules, des lots et du coût maximal estimé.
 *
 *   pnpm seed:run [--budget-max 10000] [--cout-par-1000 260] [--cellule "13|Sézane"]
 *   pnpm seed:run --execute --budget-max 10000        (workflow GitHub uniquement)
 *
 * --budget-max est le PLAFOND mensuel (centimes) ; l'arrêt dur tombe à 80 % de ce plafond,
 * réparti 85 % suivi / 15 % découverte (découverte coupée en premier).
 *
 * Codes de sortie : 0 OK · 1 erreur · 2 configuration manquante · 3 ARRÊT DUR budgétaire.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@margeo/db';
import { ApifyDriver } from '../drivers/apify.js';
import {
  ApifySeedSource,
  BrandResolver,
  budgetDepuisPlafond,
  campagneDuMois,
  cellulesExecutables,
  formatMilli,
  formatSeedPlan,
  planSeedRun,
  PrismaSeedRepository,
  readCellules,
  requireSeedEnv,
  runSeed,
  SeedConfigError,
} from '../seed/index.js';

const intArg = (name: string, v: string | undefined, def?: number): number => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (n === undefined || !Number.isInteger(n) || n < 0)
    throw new SeedConfigError(`--${name} doit être un entier positif`);
  return n;
};

/** Centimes (décimaux acceptés : « 4.6 ») → milli. */
const centsArgToMilli = (name: string, v: string | undefined): number => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0)
    throw new SeedConfigError(
      `--${name} (ou SEED_COUT_PAR_RUN_CENTS) obligatoire : frais fixes par run, en centimes d'euro`,
    );
  return Math.round(n * 1000);
};

/** Hypothèse de dry-run : frais de démarrage abotapi (0,05 $ ≈ 5 c). */
const COUT_PAR_RUN_HYPOTHESE_MILLI = 5000;

const ghEscape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** Tarifs simulés en dry-run quand le tarif réel n'est pas encore connu (doc 2b, section 3). */
const TARIFS_HYPOTHESES = [260, 357];

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'budget-max': { type: 'string' },
      'cout-par-1000': { type: 'string' },
      'cout-par-run': { type: 'string' },
      cellules: { type: 'string', default: 'seed/cellules.json' },
      cellule: { type: 'string' },
      campagne: { type: 'string' },
      batch: { type: 'string' },
      'max-decouverte': { type: 'string' },
      'log-file': { type: 'string' },
    },
  });

  const logFile = values['log-file'];
  const log = (event: string, data: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
    console.log(line);
    if (logFile) appendFileSync(logFile, `${line}\n`);
  };
  const configError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✖ Configuration du seed incomplète :\n${msg}`);
    for (const line of msg.split('\n'))
      console.log(`::error title=Seed non configuré::${ghEscape(line)}`);
    return 2;
  };

  if (values.execute && values['dry-run'])
    return configError(new SeedConfigError('--execute et --dry-run sont exclusifs'));
  const campagne = values.campagne ?? campagneDuMois('seed', new Date());
  const tarifEnv = process.env['SEED_COUT_PAR_1000_CENTS'];
  const runArg = values['cout-par-run'] ?? process.env['SEED_COUT_PAR_RUN_CENTS'];

  let configs;
  let plafondCents: number;
  let batchSize: number;
  let maxDecouverte: number;
  try {
    plafondCents = intArg(
      'budget-max',
      values['budget-max'] ?? process.env['SEED_BUDGET_CENTS_MAX'],
      10_000,
    );
    batchSize = intArg('batch', values.batch, 50);
    maxDecouverte = intArg('max-decouverte', values['max-decouverte'], 5);
    configs = readCellules(values.cellules ?? 'seed/cellules.json', values.cellule);
  } catch (err) {
    return configError(err);
  }

  // ── DRY-RUN (défaut) : rien n'est lu au-delà du fichier de cellules. ─────────────────────
  if (!values.execute) {
    const tarifArg = values['cout-par-1000'] ?? tarifEnv;
    let tarifs: number[];
    let coutParRunMilli: number;
    try {
      tarifs = tarifArg ? [intArg('cout-par-1000', tarifArg)] : TARIFS_HYPOTHESES;
      coutParRunMilli = runArg
        ? centsArgToMilli('cout-par-run', runArg)
        : COUT_PAR_RUN_HYPOTHESE_MILLI;
    } catch (err) {
      return configError(err);
    }
    const plan = planSeedRun(configs, {
      plafondCents,
      tarifs,
      coutParRunMilli,
      batchSize,
      maxDecouverteParCellule: maxDecouverte,
    });
    console.log(formatSeedPlan(plan, plafondCents, campagne));
    if (!tarifArg)
      console.log('(tarif réel inconnu : estimations aux hypothèses 2,60 € et 3,57 € / 1 000)');
    if (!runArg) console.log('(frais par run inconnus : hypothèse 5 c, abotapi 0,05 $)');
    return 0;
  }

  // ── EXECUTE ──────────────────────────────────────────────────────────────────────────────
  let env;
  let budget;
  try {
    env = requireSeedEnv(process.env);
    const coutParResultatMilli = intArg('cout-par-1000', values['cout-par-1000'] ?? tarifEnv);
    if (coutParResultatMilli === 0)
      throw new SeedConfigError('--cout-par-1000 doit être > 0 (tarif réel de l’acteur)');
    budget = budgetDepuisPlafond(
      plafondCents,
      coutParResultatMilli,
      centsArgToMilli('cout-par-run', runArg),
    );
  } catch (err) {
    return configError(err);
  }

  const prisma = createPrismaClient(env.databaseUrl);
  try {
    const repo = new PrismaSeedRepository(prisma);
    let cellules;
    let resolver;
    try {
      resolver = new BrandResolver(
        configs.map((c) => c.marque),
        await repo.loadBrandAliases(),
      );
      cellules = cellulesExecutables(configs, resolver);
    } catch (err) {
      return configError(err);
    }
    const driver = new ApifyDriver({
      actorId: env.apifyActorId,
      token: env.apifyToken,
      timeoutSecs: 280,
    });
    const result = await runSeed({
      campagne,
      cellules,
      budget,
      plafondCents,
      brandResolver: resolver,
      source: new ApifySeedSource(driver),
      repo,
      log,
      batchSize,
      maxDecouverteParCellule: maxDecouverte,
    });

    const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
    if (summaryFile) {
      appendFileSync(
        summaryFile,
        [
          `## Seed — ${result.statut}`,
          '',
          `| Dépense du run | Dépense campagne | Arrêt dur | Plafond |`,
          `|---|---|---|---|`,
          `| ${formatMilli(result.depenseRunMilli)} | ${formatMilli(result.depenseCampagneMilli)} | ${formatMilli(result.plafondMilli)} | ${formatMilli(plafondCents * 1000)} |`,
          '',
          `Annonces historiques non rattachées (non re-vérifiées) : ${result.analysesNonRattachees}`,
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
