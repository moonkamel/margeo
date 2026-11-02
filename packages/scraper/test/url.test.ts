import { describe, expect, it } from 'vitest';
import { buildCatalogSearchUrl, parseVintedItemUrl, ScraperError } from '../src/index.js';

describe('parseVintedItemUrl', () => {
  it.each([
    ['https://www.vinted.fr/items/123-robe', '123', 'https://www.vinted.fr/items/123-robe'],
    ['https://vinted.fr/items/123', '123', 'https://www.vinted.fr/items/123'],
    ['https://www.vinted.fr/items/123-robe/?x=1#y', '123', 'https://www.vinted.fr/items/123-robe'],
  ])('%s', (url, id, canonical) => {
    expect(parseVintedItemUrl(url)).toEqual({ externalId: id, canonicalUrl: canonical });
  });

  it.each([
    'pas une url',
    'http://www.vinted.fr/items/1',
    'https://www.vinted.de/items/1',
    'https://www.vinted.fr/items/abc',
    'https://evil.com/www.vinted.fr/items/1',
  ])('%s → invalid_url', (url) => {
    expect(() => parseVintedItemUrl(url)).toThrow(ScraperError);
  });
});

describe('buildCatalogSearchUrl', () => {
  it('assemble marque, catégorie et taille', () => {
    const u = new URL(buildCatalogSearchUrl('Baskets', 'Nike', '42'));
    expect(u.searchParams.get('search_text')).toBe('Nike Baskets 42');
  });
  it('ignore les champs absents', () => {
    expect(
      new URL(buildCatalogSearchUrl('Jeans', null, null)).searchParams.get('search_text'),
    ).toBe('Jeans');
  });
});
