import { describe, expect, it } from 'vitest';
import {
  isDeletedPayload,
  isDisappeared,
  isSoldPayload,
  normalizeVintedItem,
  toSoldSale,
  type ObservationPoint,
} from '../src/index.js';
import { item } from './load-fixture.js';

const H = 60 * 60 * 1000;
const t0 = new Date('2026-10-01T08:00:00Z').getTime();
const at = (heures: number, outcome: ObservationPoint['outcome']): ObservationPoint => ({
  observedAt: new Date(t0 + heures * H),
  outcome,
});

describe('isSoldPayload', () => {
  it.each(['api-sold', 'flat-sold'])('%s → vendu', (name) => {
    expect(isSoldPayload(item(name))).toBe(true);
  });
  it.each(['api-active', 'flat-active', 'closed-not-sold', 'reserved', 'partial'])(
    '%s → non vendu',
    (name) => {
      expect(isSoldPayload(item(name))).toBe(false);
    },
  );
  it('signaux alternatifs explicites', () => {
    expect(isSoldPayload({ status: 'Vendu' })).toBe(true);
    expect(isSoldPayload({ is_sold: true })).toBe(true);
    expect(isSoldPayload({ sold: 'true' })).toBe(false);
    expect(isSoldPayload(null)).toBe(false);
  });
});

describe('isDeletedPayload', () => {
  it('erreurs et marqueurs de suppression', () => {
    expect(isDeletedPayload(item('deleted'))).toBe(true);
    expect(isDeletedPayload(item('deleted-flag'))).toBe(true);
    expect(isDeletedPayload({ status: 'removed' })).toBe(true);
  });
  it('une annonce normale n’est pas supprimée', () => {
    expect(isDeletedPayload(item('api-active'))).toBe(false);
    expect(isDeletedPayload({ id: 1, message: 'not found in description' })).toBe(false);
  });
});

describe('isDisappeared', () => {
  it('active puis 2 « introuvable » espacés de 24 h → disparue', () => {
    expect(isDisappeared([at(0, 'active'), at(24, 'not_found'), at(48, 'not_found')])).toBe(true);
  });
  it('un seul « introuvable » → pas encore', () => {
    expect(isDisappeared([at(0, 'active'), at(24, 'not_found')])).toBe(false);
  });
  it('deux échecs rapprochés (erreur transitoire) → pas disparue', () => {
    expect(isDisappeared([at(0, 'active'), at(24, 'not_found'), at(24.5, 'not_found')])).toBe(
      false,
    );
  });
  it('jamais vue active → pas disparue', () => {
    expect(isDisappeared([at(0, 'not_found'), at(24, 'not_found'), at(48, 'not_found')])).toBe(
      false,
    );
  });
  it('vue vendue → c’est une vente, pas une disparition', () => {
    expect(
      isDisappeared([at(0, 'active'), at(24, 'sold'), at(48, 'not_found'), at(72, 'not_found')]),
    ).toBe(false);
  });
  it('réapparue après un échec → pas disparue', () => {
    expect(isDisappeared([at(0, 'active'), at(24, 'not_found'), at(48, 'active')])).toBe(false);
  });
  it('ordre d’entrée indifférent', () => {
    expect(isDisappeared([at(48, 'not_found'), at(0, 'active'), at(24, 'not_found')])).toBe(true);
  });
  it('seuils configurables', () => {
    const h = [at(0, 'active'), at(24, 'not_found'), at(48, 'not_found')];
    expect(isDisappeared(h, { minConsecutiveNotFound: 3 })).toBe(false);
    expect(
      isDisappeared([at(0, 'active'), at(1, 'not_found')], {
        minConsecutiveNotFound: 1,
        minSpanMs: 0,
      }),
    ).toBe(true);
  });
});

describe('toSoldSale', () => {
  it('reprend le dernier prix affiché et les attributs de cellule', () => {
    const r = normalizeVintedItem(item('api-sold'), new Date('2026-11-02T12:00:00Z'));
    if (!r.ok) throw new Error('fixture invalide');
    const soldAt = new Date('2026-11-01T10:00:00Z');
    expect(toSoldSale(r.listing, { soldAt, listedAt: null, source: 'sold_status' })).toEqual({
      prixVenteCents: 4500,
      etat: 'BON',
      categorie: 'Baskets',
      marque: 'Nike',
      taille: '42',
      soldAt,
      listedAt: null,
      source: 'sold_status',
    });
  });
});
