import { describe, expect, it } from 'vitest';
import { BrandAliasError, BrandResolver, type BrandAliasRow } from '../../src/seed/index.js';
import { ALIAS_VALIDES, NON_RATTACHES } from './alias-reference.js';

const CANONIQUES = Object.keys(ALIAS_VALIDES);
const ROWS: BrandAliasRow[] = Object.entries(ALIAS_VALIDES).flatMap(([marque, aliases]) =>
  aliases.map((alias) => ({ alias, marque, valide: true })),
);

describe('BrandResolver — non-régression section 7', () => {
  const r = new BrandResolver(CANONIQUES, ROWS);

  it.each(ROWS.map((a) => [a.alias, a.marque]))('« %s » → %s', (alias, marque) => {
    expect(r.resolve(alias)).toBe(marque);
  });

  it.each(NON_RATTACHES)('« %s » n’est rattaché à AUCUNE marque', (texte) => {
    expect(r.resolve(texte)).toBeNull();
  });

  it('casse et espaces ignorés, accents conservés', () => {
    expect(r.resolve('  nIkE ')).toBe('Nike');
    expect(r.resolve('Sézane')).toBe('Sézane');
    expect(r.resolve('sézane')).toBe('Sézane');
    // Sans l'alias validé, « Sezane » ne rejoindrait pas « Sézane ».
    expect(new BrandResolver(CANONIQUES, []).resolve('Sezane')).toBeNull();
  });

  it('marque absente ou inconnue → null', () => {
    expect(r.resolve(null)).toBeNull();
    expect(r.resolve('Zara')).toBeNull();
  });
});

describe('BrandResolver — validation', () => {
  it('un alias non validé ne rattache rien et bloque la marque', () => {
    const r = new BrandResolver(
      ['New Balance'],
      [{ alias: 'NB', marque: 'New Balance', valide: false }],
    );
    expect(r.resolve('NB')).toBeNull();
    expect(r.aliasNonValides('new balance')).toEqual(['NB']);
    expect(r.aliasNonValides('Nike')).toEqual([]);
  });

  it('alias rattaché à deux marques → erreur', () => {
    expect(
      () =>
        new BrandResolver(
          ['Polo', 'Ralph Lauren'],
          [{ alias: 'polo', marque: 'Ralph Lauren', valide: true }],
        ),
    ).toThrow(BrandAliasError);
  });
});
