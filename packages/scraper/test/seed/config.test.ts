import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCellules, requireSeedEnv, SeedConfigError } from '../../src/seed/index.js';

const dir = mkdtempSync(join(tmpdir(), 'seed-'));
const file = (content: unknown) => {
  const p = join(dir, `${Math.random()}.json`);
  writeFileSync(p, JSON.stringify(content));
  return p;
};

describe('requireSeedEnv — fail fast', () => {
  it('APIFY_TOKEN manquant → message explicite', () => {
    expect(() => requireSeedEnv({ APIFY_ACTOR_ID: 'a', DATABASE_URL: 'postgresql://x' })).toThrow(
      'APIFY_TOKEN manquant, configurer le secret',
    );
  });
  it('liste toutes les variables manquantes', () => {
    expect(() => requireSeedEnv({ APIFY_TOKEN: '  ' })).toThrow(
      /APIFY_TOKEN[\s\S]*APIFY_ACTOR_ID[\s\S]*DATABASE_URL/,
    );
  });
  it('complet → valeurs renvoyées', () => {
    expect(requireSeedEnv({ APIFY_TOKEN: 't', APIFY_ACTOR_ID: 'a', DATABASE_URL: 'd' })).toEqual({
      apifyToken: 't',
      apifyActorId: 'a',
      databaseUrl: 'd',
    });
  });
});

describe('loadCellules', () => {
  const cellules = [
    { categorie: 'Baskets', marque: 'Nike', taille: null, valide: true },
    { categorie: 'Baskets', marque: 'Adidas', valide: false },
  ];

  it('refuse toute cellule non validée', () => {
    expect(() => loadCellules(file({ cellules }))).toThrow(/non validées.*Adidas/);
  });
  it('filtre sur une seule cellule (lancement J+1)', () => {
    expect(loadCellules(file({ cellules }), 'baskets|NIKE')).toEqual([
      { categorie: 'Baskets', marque: 'Nike', taille: null },
    ]);
  });
  it('filtre sans correspondance → erreur', () => {
    expect(() => loadCellules(file({ cellules }), 'Robes|Zara')).toThrow(SeedConfigError);
  });
  it('fichier invalide → erreur de configuration', () => {
    expect(() => loadCellules(file({ cellules: [] }))).toThrow(SeedConfigError);
  });
});

describe('seed/cellules.json (proposition)', () => {
  it('15 cellules, 3 catégories × 5 marques, aucune validée tant que le go n’est pas donné', () => {
    const path = new URL('../../seed/cellules.json', import.meta.url).pathname;
    expect(() => loadCellules(path)).toThrow(/non validées/);
  });
});
