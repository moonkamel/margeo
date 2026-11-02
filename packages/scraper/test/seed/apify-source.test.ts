import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApifyDriver } from '../../src/index.js';
import { ApifySeedSource } from '../../src/seed/index.js';
import { item } from '../load-fixture.js';

const BASE = 'https://api.apify.test';
const ENDPOINT = `${BASE}/v2/acts/margeo~vinted-test/run-sync-get-dataset-items`;
const NOW = new Date('2026-11-02T12:00:00Z');
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const source = () =>
  new ApifySeedSource(
    new ApifyDriver({
      actorId: 'margeo/vinted-test',
      token: 't',
      baseUrl: BASE,
      sleep: async () => {},
      now: () => NOW,
    }),
    () => NOW,
  );

const url = (id: string) => `https://www.vinted.fr/items/${id}-x`;

describe('ApifySeedSource.recheck — lot en un seul run', () => {
  it('classe chaque annonce : active, vendue, clôturée, introuvable, illisible', async () => {
    let body: unknown;
    let appels = 0;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        appels++;
        body = await request.json();
        return HttpResponse.json([
          item('api-active'), // 4817263512
          item('api-sold'), // 4817263599
          item('closed-not-sold'), // 4817265555
          { ...(item('no-price') as object), id: 4817260001 }, // illisible
          item('deleted'), // sans id : ignoré
        ]);
      }),
    );
    const { results, resultatsFactures } = await source().recheck([
      url('4817263512'),
      url('4817263599'),
      url('4817265555'),
      url('4817260001'),
      url('4817269999'),
    ]);
    expect(appels).toBe(1);
    expect(body).toMatchObject({ maxItems: 5 });
    expect(results.map((r) => r.outcome)).toEqual([
      'active',
      'sold',
      'closed',
      'illisible',
      'not_found',
    ]);
    expect(resultatsFactures).toBe(5);
  });

  it('lot vide → aucun appel', async () => {
    expect(await source().recheck([])).toEqual({ results: [], resultatsFactures: 0 });
  });
});

describe('ApifySeedSource.discover', () => {
  it('plafonne maxItems et ne garde que les items normalisables', async () => {
    let body: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([item('api-sold'), item('flat-active'), item('no-price')]);
      }),
    );
    const { listings, resultatsFactures } = await source().discover(
      { categorie: 'Baskets', marque: 'Nike', taille: null },
      5,
    );
    expect(body).toMatchObject({ maxItems: 5 });
    expect(listings).toHaveLength(2);
    expect(resultatsFactures).toBe(3);
  });
});
