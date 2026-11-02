/**
 * Outil de debug : pnpm scraper:inspect <url-vinted> [--json]
 *
 * Récupère l'annonce via le driver configuré (ou un driver hors-ligne sans token Apify),
 * affiche l'annonce normalisée, les stats de prix disponibles et le résultat d'analyse
 * avec les préférences par défaut.
 */
import { Redis } from 'ioredis';
import {
  analyzeListing,
  DEFAULT_PREFERENCES,
  formatEuros,
  type AnalysisResult,
  type NormalizedListing,
  type PriceStats,
} from '@margeo/shared';
import { withPriceStatsCache, type CacheStore } from '../cache.js';
import { createScraperDriver } from '../factory.js';
import type { ScraperDriver } from '../driver.js';
import { ScraperError } from '../errors.js';
import { FixtureDriver } from '../drivers/fixture.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const asJson = args.includes('--json');
const url = args.find((a) => !a.startsWith('--'));

if (!url) {
  console.error('Usage : pnpm scraper:inspect <url-annonce-vinted> [--json]');
  process.exit(2);
}

const notes: string[] = [];

function pickDriver(): ScraperDriver {
  const { APIFY_TOKEN, APIFY_ACTOR_ID, SCRAPER_DRIVER } = process.env;
  if ((SCRAPER_DRIVER ?? 'apify') === 'apify' && (!APIFY_TOKEN || !APIFY_ACTOR_ID)) {
    notes.push(
      'Mode hors-ligne : APIFY_TOKEN / APIFY_ACTOR_ID absents. Annonce de DÉMONSTRATION (fixture), aucune requête réseau, aucune vente.',
    );
    return new FixtureDriver();
  }
  return createScraperDriver(process.env);
}

async function connectRedis(): Promise<Redis | null> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    notes.push('Cache désactivé : REDIS_URL absent.');
    return null;
  }
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    return redis;
  } catch {
    notes.push('Cache désactivé : Redis injoignable.');
    redis.disconnect();
    return null;
  }
}

function printHuman(listing: NormalizedListing, stats: PriceStats, analysis: AnalysisResult): void {
  const line = (label: string, value: string | number | null) =>
    console.log(`  ${label.padEnd(16)} ${value ?? '—'}`);
  for (const n of notes) console.log(`⚠  ${n}`);
  console.log('\nAnnonce normalisée');
  line('Titre', listing.titre);
  line('ID', listing.externalId);
  line('URL', listing.url);
  line('Marque', listing.marque);
  line('Catégorie', listing.categorie);
  line('Taille', listing.taille);
  line('État', listing.etat);
  line('Prix', formatEuros(listing.prixCents));
  line('Favoris / vues', `${listing.favoris} / ${listing.vues}`);
  line('Photos', listing.photos.length);
  line(
    'Vendeur',
    `${listing.vendeur.pseudo} · note ${listing.vendeur.note ?? '—'} · ${listing.vendeur.nbEvaluations ?? '—'} avis`,
  );
  line('Statut', listing.statut);

  console.log('\nStatistiques de ventes réelles');
  line('Ventes', stats.nbVentes);
  line('Médiane', stats.medianeCents === null ? null : formatEuros(stats.medianeCents));
  line(
    'Min / max',
    stats.minCents === null || stats.maxCents === null
      ? null
      : `${formatEuros(stats.minCents)} / ${formatEuros(stats.maxCents)}`,
  );

  console.log('\nAnalyse (préférences par défaut)');
  if (analysis.status === 'insufficient_data') {
    line('Résultat', analysis.message);
    line('Ventes trouvées', `${analysis.nbVentesTrouvees} (minimum ${analysis.minVentesRequis})`);
    return;
  }
  line('Marge nette', formatEuros(analysis.margin.margeNetteCents));
  line('Statut', analysis.margin.statut);
  line('Score', `${analysis.margin.score}/100 (confiance ${analysis.margin.confidence})`);
  for (const l of analysis.margin.lignes) line(`  ${l.libelle}`, formatEuros(l.montantCents));
}

async function main(target: string): Promise<number> {
  const base = pickDriver();
  // Hors-ligne : on ne touche pas au cache réel (des stats de démonstration le pollueraient 6 h).
  const offline = base instanceof FixtureDriver;
  if (offline) notes.push('Cache non utilisé en mode hors-ligne.');
  const redis = offline ? null : await connectRedis();
  try {
    const driver = redis ? withPriceStatsCache(base, redis satisfies CacheStore) : base;
    const listing = await driver.fetchListing(target);
    const stats = await driver.searchSoldPrices(listing.categorie, listing.marque, listing.taille);
    const analysis = analyzeListing({
      listing,
      ventes: stats.ventes,
      preferences: { ...DEFAULT_PREFERENCES },
      now: new Date(),
    });
    if (asJson) console.log(JSON.stringify({ notes, listing, stats, analysis }, null, 2));
    else printHuman(listing, stats, analysis);
    return 0;
  } catch (err) {
    if (err instanceof ScraperError) {
      console.error(`✖ ${err.userMessage}\n  (détail technique : ${err.code} — ${err.message})`);
    } else {
      console.error('✖ Erreur inattendue', err);
    }
    return 1;
  } finally {
    redis?.disconnect();
  }
}

process.exitCode = await main(url);
