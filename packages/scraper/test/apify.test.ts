import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApifyDriver, ScraperError, type ApifyDriverConfig } from '../src/index.js';
import { item } from './load-fixture.js';

const BASE = 'https://api.apify.test';
const ENDPOINT = `${BASE}/v2/acts/margeo~vinted-test/run-sync-get-dataset-items`;
const LISTING_URL =
  'https://www.vinted.fr/items/4817263512-jean-levis-501-bleu-brut?referrer=catalog';
const NOW = new Date('2026-11-02T12:00:00Z');

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleeps: number[] = [];
afterEach(() => {
  sleeps.length = 0;
});

function driver(overrides: Partial<ApifyDriverConfig> = {}): ApifyDriver {
  return new ApifyDriver({
    actorId: 'margeo/vinted-test',
    token: 'jeton-secret',
    baseUrl: BASE,
    timeoutSecs: 30,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    ...overrides,
  });
}

/** Répond successivement avec les réponses fournies (la dernière est répétée). */
function sequence(...responses: (() => Response)[]) {
  let calls = 0;
  server.use(
    http.post(ENDPOINT, () => {
      const r = responses[Math.min(calls, responses.length - 1)];
      calls++;
      return r?.();
    }),
  );
  return () => calls;
}

async function expectCode(p: Promise<unknown>, code: ScraperError['code']) {
  const err = await p.then(
    () => {
      throw new Error('aurait dû échouer');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ScraperError);
  expect((err as ScraperError).code).toBe(code);
  return err as ScraperError;
}

describe('ApifyDriver.fetchListing', () => {
  it('appelle l’endpoint synchrone avec le bon chemin, la bonne auth et l’entrée attendue', async () => {
    let captured: Request | undefined;
    let body: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        captured = request.clone();
        body = await request.json();
        return HttpResponse.json([item('api-active')]);
      }),
    );
    const listing = await driver().fetchListing(LISTING_URL);
    expect(listing.externalId).toBe('4817263512');
    expect(listing.prixCents).toBe(2500);
    expect(captured?.headers.get('authorization')).toBe('Bearer jeton-secret');
    const url = new URL(captured?.url ?? '');
    expect(url.searchParams.get('timeout')).toBe('30');
    expect(url.searchParams.get('token')).toBeNull(); // jamais dans l'URL
    expect(body).toEqual({
      startUrls: [{ url: 'https://www.vinted.fr/items/4817263512-jean-levis-501-bleu-brut' }],
      maxItems: 1,
    });
  });

  it('URL non Vinted → invalid_url, sans appel réseau', async () => {
    const calls = sequence(() => HttpResponse.json([]));
    await expectCode(driver().fetchListing('https://www.leboncoin.fr/items/1'), 'invalid_url');
    await expectCode(driver().fetchListing('https://www.vinted.fr/member/123'), 'invalid_url');
    expect(calls()).toBe(0);
  });

  it('dataset vide → not_found', async () => {
    sequence(() => HttpResponse.json([]));
    const e = await expectCode(driver().fetchListing(LISTING_URL), 'not_found');
    expect(e.userMessage).toMatch(/n’existe plus/);
  });

  it('payload d’annonce supprimée → not_found', async () => {
    sequence(() => HttpResponse.json([item('deleted')]));
    await expectCode(driver().fetchListing(LISTING_URL), 'not_found');
  });

  it('payload illisible (prix absent) → normalization_failed', async () => {
    sequence(() => HttpResponse.json([{ ...(item('no-price') as object), id: 4817263512 }]));
    await expectCode(driver().fetchListing(LISTING_URL), 'normalization_failed');
  });

  it('annonce renvoyée différente de celle demandée → invalid_response', async () => {
    sequence(() => HttpResponse.json([item('api-sold')]));
    await expectCode(driver().fetchListing(LISTING_URL), 'invalid_response');
  });

  it('réponse non tableau → invalid_response', async () => {
    sequence(() => HttpResponse.json({ data: [] }));
    await expectCode(driver().fetchListing(LISTING_URL), 'invalid_response');
  });
});

describe('ApifyDriver — résilience', () => {
  it('429 puis 200 → réessaie avec backoff en respectant Retry-After', async () => {
    const calls = sequence(
      () => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '2' } }),
      () => HttpResponse.json([item('api-active')]),
    );
    await expect(driver().fetchListing(LISTING_URL)).resolves.toMatchObject({
      externalId: '4817263512',
    });
    expect(calls()).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it('5xx répétés → upstream_unavailable après backoff exponentiel', async () => {
    const calls = sequence(() => new HttpResponse(null, { status: 502 }));
    const e = await expectCode(driver().fetchListing(LISTING_URL), 'upstream_unavailable');
    expect(e.retryable).toBe(true);
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('erreur réseau puis succès → réessaie', async () => {
    const calls = sequence(
      () => HttpResponse.error(),
      () => HttpResponse.json([item('api-active')]),
    );
    await expect(driver().fetchListing(LISTING_URL)).resolves.toBeDefined();
    expect(calls()).toBe(2);
  });

  it('408 (run hors délai) → timeout, sans nouvelle tentative', async () => {
    const calls = sequence(() =>
      HttpResponse.json({ error: { type: 'run-timeout-exceeded' } }, { status: 408 }),
    );
    await expectCode(driver().fetchListing(LISTING_URL), 'timeout');
    expect(calls()).toBe(1);
  });

  it('401 → auth, sans nouvelle tentative, message utilisateur sans détail technique', async () => {
    const calls = sequence(() =>
      HttpResponse.json({ error: { type: 'token-not-valid' } }, { status: 401 }),
    );
    const e = await expectCode(driver().fetchListing(LISTING_URL), 'auth');
    expect(calls()).toBe(1);
    expect(e.userMessage).not.toMatch(/401|token|apify/i);
  });

  it('400 → upstream_error non réessayable', async () => {
    sequence(() => HttpResponse.json({}, { status: 400 }));
    const e = await expectCode(driver().fetchListing(LISTING_URL), 'upstream_error');
    expect(e.retryable).toBe(false);
  });
});

describe('ApifyDriver — recherche', () => {
  it('searchListings normalise et ignore les items illisibles', async () => {
    sequence(() =>
      HttpResponse.json([item('api-active'), item('api-sold'), item('no-price'), 'junk']),
    );
    const { listings, ignores } = await driver().searchListings('Jeans', "Levi's", null);
    expect(listings).toHaveLength(2);
    expect(ignores).toBe(2);
  });

  it('searchSoldPrices ne garde que les ventes explicites de la cellule exacte', async () => {
    let body: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        body = await request.json();
        // api-sold = Nike / Baskets / 42 vendue ; flat-sold = Sony vendue (hors cellule) ;
        // api-active = non vendue.
        const autreTaille = {
          ...(item('api-sold') as object),
          id: 99,
          size_title: '43',
          price: '60.0',
        };
        const memeCellule = {
          ...(item('api-sold') as object),
          id: 98,
          brand_title: 'NIKE',
          price: '55.0',
        };
        return HttpResponse.json([
          item('api-active'),
          item('api-sold'),
          item('flat-sold'),
          autreTaille,
          memeCellule,
        ]);
      }),
    );
    const stats = await driver({ maxSearchItems: 50 }).searchSoldPrices('Baskets', 'Nike', '42');
    expect(body).toMatchObject({ maxItems: 50 });
    expect(stats).toMatchObject({
      categorie: 'Baskets',
      marque: 'Nike',
      taille: '42',
      nbVentes: 2,
      medianeCents: 5000,
      minCents: 4500,
      maxCents: 5500,
      collecteAt: NOW,
    });
    expect(stats.ventes.every((v) => v.source === 'sold_status')).toBe(true);
  });

  it('aucune vente → stats vides, pas de médiane inventée', async () => {
    sequence(() => HttpResponse.json([item('api-active')]));
    const stats = await driver().searchSoldPrices('Jeans', null, null);
    expect(stats).toMatchObject({
      nbVentes: 0,
      medianeCents: null,
      minCents: null,
      maxCents: null,
    });
  });
});
