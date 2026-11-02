/**
 * Vérification du volume des cellules. DRY-RUN PAR DÉFAUT : sans --execute, aucun appel Apify,
 * aucune base, aucun token lu — cellules, URL de catalogue et coût maximal estimé.
 *
 *   pnpm seed:verify-volume [--etape pilotes|reste] [--max-items 200] [--cout-par-1000 260]
 *   pnpm seed:verify-volume --execute --etape pilotes --cout-par-1000 <tarif réel>
 *
 * Budget dédié : campagne verify-YYYY-MM, plafond 12 €, arrêt dur 11 €.
 * Codes de sortie : 0 OK · 1 erreur · 2 configuration · 3 arrêt dur budgétaire · 4 arrêt sur critère.
 */
import { parseArgs } from 'node:util';
import { createPrismaClient } from '@margeo/db';
import { ApifyDriver } from '../drivers/apify.js';
import { normalizeVintedItem } from '../normalize.js';
import {
  BrandResolver,
  campagneDuMois,
  ciblesVerification,
  formatMilli,
  formatVerifPlan,
  PrismaSeedRepository,
  readCellules,
  requireSeedEnv,
  runVerifyVolume,
  SeedConfigError,
  VERIFY_MAX_ITEMS,
  type EtapeVerif,
} from '../seed/index.js';

const TARIFS_HYPOTHESES = [260, 357];

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

const intArg = (name: string, v: string | undefined, def?: number): number => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (n === undefined || !Number.isInteger(n) || n <= 0)
    throw new SeedConfigError(`--${name} doit être un entier strictement positif`);
  return n;
};

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      execute: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      etape: { type: 'string', default: 'pilotes' },
      'max-items': { type: 'string' },
      'cout-par-1000': { type: 'string' },
      'cout-par-run': { type: 'string' },
      cellules: { type: 'string', default: 'seed/cellules.json' },
    },
  });
  const fail = (err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  };

  let etape: EtapeVerif;
  let maxItems: number;
  let cibles;
  try {
    if (values.execute && values['dry-run'])
      throw new SeedConfigError('--execute et --dry-run sont exclusifs');
    if (values.etape !== 'pilotes' && values.etape !== 'reste')
      throw new SeedConfigError('--etape doit valoir « pilotes » ou « reste »');
    etape = values.etape;
    maxItems = intArg('max-items', values['max-items'], VERIFY_MAX_ITEMS);
    cibles = ciblesVerification(readCellules(values.cellules ?? 'seed/cellules.json'), etape);
  } catch (err) {
    return fail(err);
  }
  const campagne = campagneDuMois('verify', new Date());
  const tarifArg = values['cout-par-1000'] ?? process.env['SEED_COUT_PAR_1000_CENTS'];
  const runArg = values['cout-par-run'] ?? process.env['SEED_COUT_PAR_RUN_CENTS'];

  if (!values.execute) {
    let tarifs: number[];
    let coutParRunMilli: number;
    try {
      tarifs = tarifArg ? [intArg('cout-par-1000', tarifArg)] : TARIFS_HYPOTHESES;
      coutParRunMilli = runArg
        ? centsArgToMilli('cout-par-run', runArg)
        : COUT_PAR_RUN_HYPOTHESE_MILLI;
    } catch (err) {
      return fail(err);
    }
    console.log(formatVerifPlan(cibles, etape, campagne, maxItems, tarifs, coutParRunMilli));
    if (!runArg) console.log('(frais par run inconnus : hypothèse 5 c, abotapi 0,05 $)');
    if (!tarifArg)
      console.log('(tarif réel inconnu : estimations aux hypothèses 2,60 € et 3,57 € / 1 000)');
    return 0;
  }

  let env;
  let tarif: number;
  let coutParRunMilli: number;
  try {
    env = requireSeedEnv(process.env);
    tarif = intArg('cout-par-1000', tarifArg);
    coutParRunMilli = centsArgToMilli('cout-par-run', runArg);
  } catch (err) {
    return fail(err);
  }
  const prisma = createPrismaClient(env.databaseUrl);
  try {
    const repo = new PrismaSeedRepository(prisma);
    const driver = new ApifyDriver({
      actorId: env.apifyActorId,
      token: env.apifyToken,
      timeoutSecs: 280,
    });
    const r = await runVerifyVolume({
      campagne,
      cibles,
      coutParResultatMilli: tarif,
      coutParRunMilli,
      maxItems,
      resolver: new BrandResolver(
        cibles.map((c) => c.marque),
        await repo.loadBrandAliases(),
      ),
      repo,
      search: (url, max) => driver.searchRawUrl(url, max),
      marqueOf: (raw) => {
        const n = normalizeVintedItem(raw, new Date());
        return n.ok ? n.listing.marque : null;
      },
    });
    for (const x of r.resultats) {
      console.log(
        `${x.verdict.padEnd(10)} ${x.nom} : ${x.marque} annonces de la marque / ${x.resultats} résultats${x.plafondAtteint ? ' (plafond atteint)' : ''} — ${formatMilli(x.coutMilli)}`,
      );
    }
    console.log(`Dépense campagne ${campagne} : ${formatMilli(r.depenseCampagneMilli)}`);
    if (r.arret) console.log(r.arret);
    return r.statut === 'BUDGET_STOPPED' ? 3 : r.statut === 'STOPPED' ? 4 : 0;
  } catch (err) {
    console.error(`✖ ${String(err)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
