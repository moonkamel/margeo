import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BrandResolver,
  cellulesExecutables,
  loadCellules,
  readCellules,
  requireSeedEnv,
  SeedConfigError,
} from '../../src/seed/index.js';

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

const c = (o: Record<string, unknown> = {}) => ({
  categorie: 'Sweats et pulls (H)',
  catalogId: 79,
  marque: 'AMI Paris',
  taille: null,
  tier: 'tertiary',
  cibleActives: 20,
  valide: true,
  ...o,
});

describe('readCellules — schéma', () => {
  it.each([
    ['priority', 70],
    ['secondary', 30],
    ['tertiary', 20],
  ])('tier %s ↔ cibleActives %i accepté', (tier, cibleActives) => {
    expect(readCellules(file({ cellules: [c({ tier, cibleActives })] }))).toHaveLength(1);
  });

  it.each([
    ['priority', 30],
    ['secondary', 70],
    ['tertiary', 21],
  ])('tier %s avec cibleActives %i → refusé', (tier, cibleActives) => {
    expect(() => readCellules(file({ cellules: [c({ tier, cibleActives })] }))).toThrow(
      /cibleActives ne correspond pas au tier/,
    );
  });

  it.each(['tier', 'cibleActives', 'valide', 'catalogId'])('champ %s obligatoire', (champ) => {
    const sans = Object.fromEntries(Object.entries(c()).filter(([k]) => k !== champ));
    expect(() => readCellules(file({ cellules: [sans] }))).toThrow(SeedConfigError);
  });

  it('tier inconnu → refusé', () => {
    expect(() => readCellules(file({ cellules: [c({ tier: 'gold' })] }))).toThrow(SeedConfigError);
  });

  it('cellule en double (même catalogue et marque, casse ignorée) → refusé', () => {
    expect(() =>
      readCellules(file({ cellules: [c(), c({ marque: 'ami paris', categorie: 'Autre' })] })),
    ).toThrow(/en double/);
  });

  it('fichier vide → erreur de configuration', () => {
    expect(() => readCellules(file({ cellules: [] }))).toThrow(SeedConfigError);
  });

  it('filtre par libellé ou par identifiant de catalogue (lancement J+1)', () => {
    const p = file({ cellules: [c(), c({ marque: 'Ralph Lauren' })] });
    expect(readCellules(p, 'sweats et pulls (h)|ami paris').map((x) => x.marque)).toEqual([
      'AMI Paris',
    ]);
    expect(readCellules(p, '79|Ralph Lauren').map((x) => x.marque)).toEqual(['Ralph Lauren']);
    expect(() => readCellules(p, 'Robes|Zara')).toThrow(/Aucune cellule/);
  });
});

describe('cellulesExecutables — mode --execute', () => {
  it('refuse une cellule non validée', () => {
    expect(() =>
      loadCellules(file({ cellules: [c(), c({ marque: 'X', valide: false })] })),
    ).toThrow(/X : non validée/);
  });

  it('refuse une cellule sans identifiant de catalogue', () => {
    expect(() => loadCellules(file({ cellules: [c({ catalogId: null })] }))).toThrow(
      /identifiant de catalogue inconnu/,
    );
  });

  it('refuse une cellule dont la marque a un alias non validé', () => {
    const r = new BrandResolver(
      ['New Balance'],
      [{ alias: 'NB', marque: 'New Balance', valide: false }],
    );
    expect(() => cellulesExecutables([c({ marque: 'New Balance' })] as never, r)).toThrow(
      /alias non validés : NB/,
    );
  });

  it('cellule crawlable → champs utiles, catalogId numérique', () => {
    expect(loadCellules(file({ cellules: [c()] }))).toEqual([
      {
        categorie: 'Sweats et pulls (H)',
        catalogId: 79,
        marque: 'AMI Paris',
        taille: null,
        tier: 'tertiary',
        cibleActives: 20,
      },
    ]);
  });
});

describe('seed/cellules.json', () => {
  const path = new URL('../../seed/cellules.json', import.meta.url).pathname;
  const cellules = readCellules(path);

  it('15 cellules, 3 catégories × 5 marques, tier et cibleActives cohérents', () => {
    expect(cellules).toHaveLength(15);
    const parTier = (t: string) => cellules.filter((x) => x.tier === t).length;
    expect([parTier('priority'), parTier('secondary'), parTier('tertiary')]).toEqual([5, 5, 5]);
  });

  it('catalogues relevés le 2026-11-04 : pulls 13 (F) / 79 (H), baskets Nike et Adidas 1242 (H)', () => {
    const cat = Object.fromEntries(cellules.map((x) => [x.marque, x.catalogId]));
    expect(cat).toMatchObject({
      Nike: 1242,
      Adidas: 1242,
      'New Balance': null,
      Asics: null,
      Veja: null,
      Apple: null,
      Sézane: 13,
      Sandro: 13,
      Maje: 13,
      'AMI Paris': 79,
      'Ralph Lauren': 79,
    });
  });

  it('aucune cellule crawlable tant que le go n’est pas donné', () => {
    expect(cellules.every((x) => !x.valide)).toBe(true);
    expect(() => loadCellules(path)).toThrow(/non crawlables/);
  });
});
