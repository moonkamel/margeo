import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  abotapiSearchInput,
  abotapiUrlInput,
  ABOTAPI_INPUT_BUILDERS,
  ApifyAsyncRunner,
  buildCellSearchUrl,
  inputBuildersPourActeur,
  ScraperError,
} from '../src/index.js';
import { ApifySeedSource } from '../src/seed/index.js';
import { cellule } from './seed/fake-source.js';

const BASE = 'https://api.apify.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('input abotapi — recherche', () => {
  it('cellule → mode search, categoryId en chaîne, fetchDetails explicite, maxItems', () => {
    const url = buildCellSearchUrl(13, 'Sézane', null);
    expect(abotapiSearchInput(url, 5)).toStrictEqual({
      mode: 'search',
      queries: ['Sézane'],
      categoryId: '13',
      maxItems: 5,
      fetchDetails: true,
      sortBy: 'newest_first',
    });
    expect(typeof abotapiSearchInput(url, 5).categoryId).toBe('string');
  });

  it('aucun champ hors liste : clés exactes', () => {
    const input = abotapiSearchInput(buildCellSearchUrl(1242, 'Nike', null), 200);
    expect(Object.keys(input).sort()).toEqual(
      ['categoryId', 'fetchDetails', 'maxItems', 'mode', 'queries', 'sortBy'].sort(),
    );
  });

  it.each([
    [
      'filtre inconnu (taille)',
      'https://www.vinted.fr/catalog?catalog[]=13&search_text=S&size_ids[]=4',
    ],
    ['deux catalogues', 'https://www.vinted.fr/catalog?catalog[]=13&catalog[]=79&search_text=S'],
    ['sans catalogue', 'https://www.vinted.fr/catalog?search_text=S'],
    ['sans texte', 'https://www.vinted.fr/catalog?catalog[]=13'],
    ['autre ordre', 'https://www.vinted.fr/catalog?catalog[]=13&search_text=S&order=relevance'],
  ])('refus : %s (rien n’est envoyé)', (_, url) => {
    expect(() => abotapiSearchInput(url, 5)).toThrow(ScraperError);
  });

  it('maxItems invalide refusé', () => {
    const url = buildCellSearchUrl(13, 'Sézane', null);
    expect(() => abotapiSearchInput(url, 0)).toThrow();
    expect(() => abotapiSearchInput(url, 1.5)).toThrow();
  });
});

describe('input abotapi — re-vérification', () => {
  it('mode url, maxItems = nombre d’URL, fetchDetails explicite, clés exactes', () => {
    const urls = ['https://www.vinted.fr/items/1-a', 'https://www.vinted.fr/items/2-b'];
    expect(abotapiUrlInput(urls)).toStrictEqual({
      mode: 'url',
      urls,
      maxItems: 2,
      fetchDetails: true,
    });
    expect(ABOTAPI_INPUT_BUILDERS.listing('https://www.vinted.fr/items/1-a')).toStrictEqual({
      mode: 'url',
      urls: ['https://www.vinted.fr/items/1-a'],
      maxItems: 1,
      fetchDetails: true,
    });
  });

  it('lot vide refusé', () => {
    expect(() => abotapiUrlInput([])).toThrow();
  });
});

describe('sélection des builders par acteur', () => {
  it('abotapi reconnu (« / » ou « ~ »), tout autre acteur refusé', () => {
    expect(inputBuildersPourActeur('abotapi/vinted-fr-scraper')).toBe(ABOTAPI_INPUT_BUILDERS);
    expect(inputBuildersPourActeur('abotapi~vinted-fr-scraper')).toBe(ABOTAPI_INPUT_BUILDERS);
    expect(() => inputBuildersPourActeur('kazkn/vinted-smart-scraper')).toThrow(
      /sans mapping d'input validé/,
    );
  });
});

describe('corps réellement envoyé à Apify (runner asynchrone + source du seed, en mock)', () => {
  const PLAFOND = { maxTotalChargeUsd: 0.87 };
  const source = () =>
    new ApifySeedSource(
      new ApifyAsyncRunner({
        actorId: 'abotapi/vinted-fr-scraper',
        token: 't',
        baseUrl: BASE,
        timeoutSecs: 600,
        sleep: async () => {},
      }),
      inputBuildersPourActeur('abotapi/vinted-fr-scraper'),
    );
  const capture = () => {
    const envois: { corps: unknown; params: Record<string, string> }[] = [];
    server.use(
      http.post(`${BASE}/v2/acts/abotapi~vinted-fr-scraper/runs`, async ({ request }) => {
        envois.push({
          corps: await request.json(),
          params: Object.fromEntries(new URL(request.url).searchParams),
        });
        return HttpResponse.json({ data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } });
      }),
      http.get(`${BASE}/v2/actor-runs/r`, () =>
        HttpResponse.json({ data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } }),
      ),
      http.get(`${BASE}/v2/datasets/d/items`, () => HttpResponse.json([])),
    );
    return envois;
  };

  it('découverte d’une cellule : input strict + plafonds de plateforme', async () => {
    const envois = capture();
    await source().discover(
      cellule('Sweats et pulls (H)', 'Ralph Lauren', { catalogId: 79 }),
      5,
      PLAFOND,
    );
    expect(envois).toStrictEqual([
      {
        corps: {
          mode: 'search',
          queries: ['Ralph Lauren'],
          categoryId: '79',
          maxItems: 5,
          fetchDetails: true,
          sortBy: 'newest_first',
        },
        params: { timeout: '600', memory: '1024', maxItems: '5', maxTotalChargeUsd: '0.87' },
      },
    ]);
  });

  it('re-vérification d’un lot (URL canoniques)', async () => {
    const envois = capture();
    await source().recheck(
      [
        'https://www.vinted.fr/items/123-pull?referrer=x',
        'https://www.vinted.fr/items/456-cardigan',
      ],
      PLAFOND,
    );
    expect(envois.map((e) => e.corps)).toStrictEqual([
      {
        mode: 'url',
        urls: ['https://www.vinted.fr/items/123-pull', 'https://www.vinted.fr/items/456-cardigan'],
        maxItems: 2,
        fetchDetails: true,
      },
    ]);
    expect(envois[0]?.params['maxItems']).toBe('2');
  });

  it('comptage (vérification du volume) : fetchDetails explicitement false', () => {
    const b = inputBuildersPourActeur('abotapi/vinted-fr-scraper', 'comptage');
    expect(b.search(buildCellSearchUrl(1242, 'Nike', null), 200)).toStrictEqual({
      mode: 'search',
      queries: ['Nike'],
      categoryId: '1242',
      maxItems: 200,
      fetchDetails: false,
      sortBy: 'newest_first',
    });
  });
});
