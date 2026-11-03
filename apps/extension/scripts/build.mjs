/**
 * Build de l'extension : esbuild (aucune dépendance ajoutée — résolu depuis l'installation
 * existante du dépôt tant que le lockfile n'est pas mis à jour), puis copie des fichiers statiques
 * dans dist/. Charger dist/ via chrome://extensions → « Charger l'extension non empaquetée ».
 *
 * Le token d'API est lu dans .env AU BUILD et injecté dans service-worker.js uniquement : il ne
 * figure dans aucun fichier du dépôt (dist/ et .env sont ignorés par git).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
const DIST = join(RACINE, 'dist');

function chargerEsbuild() {
  const local = createRequire(join(RACINE, 'package.json'));
  try {
    return local('esbuild');
  } catch {
    // Pas encore dans le lockfile : esbuild de l'installation existante (via tsx du scraper).
    const scraper = createRequire(join(RACINE, '../../packages/scraper/package.json'));
    return createRequire(scraper.resolve('tsx/package.json'))('esbuild');
  }
}

function lireEnv() {
  const env = {};
  const fichier = join(RACINE, '.env');
  if (!existsSync(fichier)) return env;
  for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(ligne);
    if (m && !ligne.trimStart().startsWith('#')) env[m[1]] = m[2];
  }
  return env;
}

const env = { ...lireEnv(), ...process.env };
const esbuild = chargerEsbuild();
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const commun = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  logLevel: 'warning',
  define: {
    __MARGEO_MOCK__: JSON.stringify((env.MARGEO_MOCK ?? '1') !== '0'),
    __MARGEO_API_URL__: JSON.stringify(env.MARGEO_API_URL ?? 'http://localhost:3000'),
  },
};
await esbuild.build({
  ...commun,
  entryPoints: { 'service-worker': join(RACINE, 'src/background/service-worker.ts') },
  outdir: DIST,
  define: { ...commun.define, __MARGEO_API_TOKEN__: JSON.stringify(env.MARGEO_API_TOKEN ?? '') },
});
// Le token n'est injecté QUE dans le service worker : contenu et panneau n'y ont pas accès.
await esbuild.build({
  ...commun,
  format: 'iife',
  entryPoints: { content: join(RACINE, 'src/content/content.ts') },
  outdir: DIST,
});
await esbuild.build({
  ...commun,
  entryPoints: { sidepanel: join(RACINE, 'src/sidepanel/main.ts') },
  outdir: DIST,
});
cpSync(join(RACINE, 'public'), DIST, { recursive: true });
cpSync(join(RACINE, 'src/sidepanel/sidepanel.html'), join(DIST, 'sidepanel.html'));
cpSync(join(RACINE, 'src/sidepanel/sidepanel.css'), join(DIST, 'sidepanel.css'));
console.log(
  `Extension construite dans ${DIST} (mode ${commun.define.__MARGEO_MOCK__ === 'true' ? 'maquette' : 'API'})`,
);
