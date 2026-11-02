import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** CLI réelle, environnement VIDÉ de tout secret : le dry-run ne doit rien lire d'autre. */
const PKG = fileURLToPath(new URL('../..', import.meta.url));
const cli = (script: string, args: string[], extraEnv: Record<string, string> = {}) =>
  spawnSync('pnpm', ['exec', 'tsx', '--conditions=@margeo/source', script, ...args], {
    cwd: PKG,
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...extraEnv },
    encoding: 'utf8',
    timeout: 120_000,
  });

describe('seed:run — CLI', { timeout: 150_000 }, () => {
  it('sans --execute : dry-run, aucun secret requis, sortie 0', () => {
    const r = cli('src/cli/seed-run.ts', ['--budget-max', '10000']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/DRY-RUN/);
    expect(r.stdout).toMatch(/arrêt dur 80,00 € \(suivi 68,00 €, découverte 12,00 €\)/);
    expect(r.stdout).toMatch(/dry-run, aucune dépense/);
  });

  it('--execute sans configuration : sortie 2, message explicite, aucun appel', () => {
    const r = cli('src/cli/seed-run.ts', ['--execute', '--budget-max', '10000']);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/APIFY_TOKEN manquant/);
  });

  it('--execute et --dry-run ensemble : refusé', () => {
    const r = cli('src/cli/seed-run.ts', ['--execute', '--dry-run']);
    expect(r.status).toBe(2);
  });
});

describe('seed:verify-volume — CLI', { timeout: 150_000 }, () => {
  it('sans --execute : dry-run des pilotes, aucun secret requis, sortie 0', () => {
    const r = cli('src/cli/seed-verify-volume.ts', []);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/DRY-RUN.*étape pilotes/);
    expect(r.stdout).toMatch(/dry-run, aucune dépense/);
  });

  it('--execute sans configuration : sortie 2, aucun appel', () => {
    const r = cli('src/cli/seed-verify-volume.ts', ['--execute', '--cout-par-1000', '260']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/APIFY_TOKEN manquant/);
  });
});

describe('acteur sans mapping d’input validé — CLI', { timeout: 150_000 }, () => {
  // Valeurs factices : la vérification de l'acteur échoue AVANT toute connexion (base, Apify).
  const env = {
    APIFY_TOKEN: 'factice',
    APIFY_ACTOR_ID: 'kazkn/vinted-smart-scraper',
    DATABASE_URL: 'postgresql://factice@127.0.0.1:1/factice',
  };
  it.each([
    ['src/cli/seed-run.ts', ['--execute', '--cout-par-1000', '240', '--cout-par-run', '5']],
    [
      'src/cli/seed-verify-volume.ts',
      ['--execute', '--cout-par-1000', '240', '--cout-par-run', '5'],
    ],
  ])('%s --execute → sortie 2', (script, args) => {
    const r = cli(script, args, env);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/sans mapping d'input validé/);
  });
});

describe('seed:backfill-verify — CLI', { timeout: 150_000 }, () => {
  it('sans --execute : dry-run, rien n’est écrit, aucune base requise', () => {
    const r = cli('src/cli/seed-backfill-verify.ts', ['--amount-cents', '24', '--note', 'tests']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/DRY-RUN.*0,24 € dans verify-\d{4}-\d{2}/);
  });

  it('montant ou note manquant → sortie 2', () => {
    expect(cli('src/cli/seed-backfill-verify.ts', ['--note', 'x']).status).toBe(2);
    expect(cli('src/cli/seed-backfill-verify.ts', ['--amount-cents', '24']).status).toBe(2);
  });
});
