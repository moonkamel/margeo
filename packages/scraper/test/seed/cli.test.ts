import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** CLI réelle, environnement VIDÉ de tout secret : le dry-run ne doit rien lire d'autre. */
const PKG = fileURLToPath(new URL('../..', import.meta.url));
const cli = (script: string, args: string[]) =>
  spawnSync('pnpm', ['exec', 'tsx', '--conditions=@margeo/source', script, ...args], {
    cwd: PKG,
    env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },
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
