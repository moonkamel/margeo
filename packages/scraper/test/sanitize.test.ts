import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitizeListingPayload } from '../src/index.js';

/** Payloads synthétiques : mêmes clés que les sorties réelles kazkn et abotapi (2026-11-04). */
const PAYLOADS = JSON.parse(
  readFileSync(new URL('./fixtures/payloads-acteurs.json', import.meta.url), 'utf8'),
) as Record<'kazkn' | 'abotapiDetails', Record<string, unknown>>;

const INTERDITS = /^(seller|description$|photos?$|photoCount$|image$|mainImage$|user$|country$)/i;

describe('sanitizeListingPayload — minimisation RGPD', () => {
  it.each(Object.entries(PAYLOADS))('%s : aucun champ vendeur, description ni photo', (_, raw) => {
    const out = sanitizeListingPayload(raw);
    const cles = Object.keys(out);
    expect(cles.filter((k) => INTERDITS.test(k))).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/seller|example\.invalid\/(photo|image|seller)/i);
  });

  it('abotapi (fetchDetails) : champs utiles conservés', () => {
    const out = sanitizeListingPayload(PAYLOADS.abotapiDetails);
    expect(out).toMatchObject({
      catalogId: '529',
      categoryId: '529',
      categoryPath: "Femmes Pulls d'hiver",
      brandTitle: 'Sézane',
      brand: { id: 'x', title: 'Sézane', slug: 'sezane' },
      colors: ['Gris'],
    });
    for (const k of ['itemId', 'title', 'url', 'priceAmount', 'currency', 'size', 'condition'])
      expect(out).toHaveProperty(k);
    for (const k of ['isReserved', 'isHidden', 'isClosed', 'itemClosingAction', 'scrapedAt'])
      expect(out).toHaveProperty(k);
  });

  it('kazkn : champs utiles conservés', () => {
    const out = sanitizeListingPayload(PAYLOADS.kazkn);
    expect(out).toMatchObject({ brand: 'Nike', isSold: false, price: 5, currency: 'EUR' });
    for (const k of ['id', 'title', 'url', 'size', 'condition', 'favouriteCount', 'viewCount'])
      expect(out).toHaveProperty(k);
  });

  it('allowlist : un champ inconnu n’est jamais stocké (ex. sellerEmail, contact)', () => {
    const out = sanitizeListingPayload({
      id: 1,
      sellerEmail: 'a@b.c',
      contact: '06 00 00 00 00',
      nouveauChamp: 'x',
      user: { login: 'pseudo' },
    });
    expect(out).toEqual({ id: 1 });
  });

  it('objets autorisés réduits à leurs sous-champs, objets imprévus écartés', () => {
    expect(
      sanitizeListingPayload({
        brand: { id: 53, title: 'Nike', owner: { login: 'x' } },
        price: { amount: '30.0', currency_code: 'EUR', seller_fee: 1 },
        status: { nested: true },
        colors: ['Gris', { id: 1 }],
      }),
    ).toEqual({
      brand: { id: 53, title: 'Nike' },
      price: { amount: '30.0', currency_code: 'EUR' },
    });
  });

  it('entrée non objet → objet vide', () => {
    for (const v of [null, undefined, 'x', 3, [1]]) expect(sanitizeListingPayload(v)).toEqual({});
  });
});
