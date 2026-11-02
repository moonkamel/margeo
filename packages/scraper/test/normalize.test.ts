import { describe, expect, it } from 'vitest';
import { normalizedListingSchema } from '@margeo/shared';
import {
  CATEGORIE_INCONNUE,
  normalizeVintedItem,
  parsePriceToCents,
  type NormalizeResult,
} from '../src/index.js';
import { item } from './load-fixture.js';

const NOW = new Date('2026-11-02T12:00:00Z');

function ok(r: NormalizeResult) {
  if (!r.ok) throw new Error(`échec inattendu : ${r.reason} (${r.detail})`);
  expect(() => normalizedListingSchema.parse(r.listing)).not.toThrow();
  return r;
}
const normalize = (name: string) => normalizeVintedItem(item(name), NOW);

describe('normalizeVintedItem — annonces valides', () => {
  it('1. format API Vinted complet', () => {
    const { listing, warnings } = ok(normalize('api-active'));
    expect(listing).toEqual({
      plateforme: 'VINTED',
      externalId: '4817263512',
      url: 'https://www.vinted.fr/items/4817263512-jean-levis-501-bleu-brut',
      titre: "Jean Levi's 501 bleu brut",
      marque: "Levi's",
      categorie: 'Jeans',
      taille: 'W32 | FR 42',
      etat: 'TRES_BON',
      prixCents: 2500,
      favoris: 14,
      vues: 233,
      photos: [
        'https://images1.vinted.net/t/01_abc/f800/a.jpeg',
        'https://images1.vinted.net/t/01_abc/310x430/b.jpeg',
      ],
      description: 'Porté quelques fois, aucun défaut.',
      vendeur: { pseudo: 'marie_vend', ancienneteJours: 1461, note: 4.8, nbEvaluations: 127 },
      statut: 'active',
    });
    expect(warnings).toEqual([]);
  });

  it('2. format API Vinted vendu (item_closing_action = sold), prix en chaîne', () => {
    const { listing } = ok(normalize('api-sold'));
    expect(listing.statut).toBe('sold');
    expect(listing.prixCents).toBe(4500);
    expect(listing.etat).toBe('BON');
    expect(listing.vendeur.note).toBe(5);
  });

  it('3. format aplati d’acteur (brand/condition/seller), prix décimal', () => {
    const { listing } = ok(normalize('flat-active'));
    expect(listing).toMatchObject({
      externalId: '5100000001',
      marque: 'Sézane',
      taille: 'M',
      etat: 'NEUF_AVEC_ETIQUETTE',
      prixCents: 5990,
      favoris: 8,
      vues: 97,
      categorie: 'Pulls et sweats',
      photos: ['https://images1.vinted.net/t/02/f800/p.jpeg'],
      vendeur: { pseudo: 'chloe.closet', note: 4.8, nbEvaluations: 54 },
      statut: 'active',
    });
    expect(listing.vendeur.ancienneteJours).toBeGreaterThan(2000);
  });

  it('4. format aplati vendu (isSold), libellé d’état anglais, prix « 120,00 »', () => {
    const { listing } = ok(normalize('flat-sold'));
    expect(listing.statut).toBe('sold');
    expect(listing.etat).toBe('TRES_BON');
    expect(listing.prixCents).toBe(12000);
    expect(listing.categorie).toBe('Électronique');
  });

  it('5. URL relative complétée, photos invalides ignorées avec avertissement', () => {
    const { listing, warnings } = ok(normalize('relative-url'));
    expect(listing.url).toBe('https://www.vinted.fr/items/4817264444-veste-ami-paris');
    expect(listing.photos).toEqual(['https://images1.vinted.net/t/03/f800/v.jpeg']);
    expect(listing.etat).toBe('NEUF_AVEC_ETIQUETTE');
    expect(listing.vendeur.note).toBe(4.4);
    expect(warnings).toContain('photos_ignorees');
  });
});

describe('normalizeVintedItem — payloads partiels', () => {
  it('6. sans marque, taille, vues ni note : valeurs nulles/0 et avertissements', () => {
    const { listing, warnings } = ok(normalize('partial'));
    expect(listing).toMatchObject({
      marque: null,
      taille: null,
      vues: 0,
      favoris: 0,
      photos: [],
      description: '',
      etat: 'SATISFAISANT',
      prixCents: 350,
      url: 'https://www.vinted.fr/items/4817261111',
      vendeur: { pseudo: 'anon42', note: null, ancienneteJours: null, nbEvaluations: null },
    });
    expect(warnings).toEqual(
      expect.arrayContaining(['marque_absente', 'taille_absente', 'vendeur_incomplet']),
    );
  });

  it('7. prix absent → échec explicite (aucun prix inventé)', () => {
    expect(normalize('no-price')).toMatchObject({ ok: false, reason: 'invalid_payload' });
  });

  it('8. état non reconnu → échec explicite', () => {
    expect(normalize('unknown-condition')).toMatchObject({ ok: false, reason: 'invalid_payload' });
  });

  it('9. identifiant ou titre manquant → échec', () => {
    expect(normalizeVintedItem({ title: 'x', price: '1', status_id: 2 }, NOW)).toMatchObject({
      ok: false,
    });
    expect(normalizeVintedItem({ id: 1, price: '1', status_id: 2 }, NOW)).toMatchObject({
      ok: false,
    });
  });

  it('10. devise autre que l’euro → refus', () => {
    expect(normalize('usd')).toMatchObject({ ok: false, reason: 'unsupported_currency' });
  });
});

describe('normalizeVintedItem — catégories inconnues', () => {
  it('11. catalog_id sans libellé → catégorie traçable « catalogue-<id> »', () => {
    const { listing, warnings } = ok(normalize('unknown-category'));
    expect(listing.categorie).toBe('catalogue-999999');
    expect(warnings).toContain('categorie_inconnue');
  });

  it('12. aucune information de catégorie → « inconnue »', () => {
    const { listing, warnings } = ok(normalize('no-category'));
    expect(listing.categorie).toBe(CATEGORIE_INCONNUE);
    expect(warnings).toContain('categorie_inconnue');
  });
});

describe('normalizeVintedItem — annonces supprimées', () => {
  it('13. réponse d’erreur « Item not found »', () => {
    expect(normalize('deleted')).toMatchObject({ ok: false, reason: 'deleted' });
  });

  it('14. marqueur is_deleted', () => {
    expect(normalize('deleted-flag')).toMatchObject({ ok: false, reason: 'deleted' });
  });

  it('15. payload non objet (null, chaîne, tableau)', () => {
    for (const v of [null, 'oops', [1, 2], 42]) {
      expect(normalizeVintedItem(v, NOW)).toMatchObject({ ok: false, reason: 'invalid_payload' });
    }
  });
});

describe('normalizeVintedItem — statut', () => {
  it('16. annonce clôturée sans vente → pas « sold »', () => {
    expect(ok(normalize('closed-not-sold')).listing.statut).toBe('active');
  });

  it('17. annonce réservée → pas « sold »', () => {
    expect(ok(normalize('reserved')).listing.statut).toBe('active');
  });
});

describe('parsePriceToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12,50', 1250],
    ['0.1', 10],
    ['1 234,00 €', 123400],
    ['19.999', 1999],
    ['1\u202f234,00\u00a0€', 123400],
    [19.99, 1999],
    [0.29, 29],
  ] as const)('%s → %i', (input, expected) => {
    expect(parsePriceToCents(input)).toBe(expected);
  });

  it.each([['abc'], ['-5'], [''], [-1], [Number.NaN], [null]])('%s → null', (input) => {
    expect(parsePriceToCents(input)).toBeNull();
  });
});
