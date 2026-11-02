import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApifyAsyncRunner } from '../src/index.js';

/** API Apify simulée (msw) : aucun appel réseau réel. */
const BASE = 'https://api.apify.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const runner = (now: () => number = Date.now) =>
  new ApifyAsyncRunner({
    actorId: 'abotapi/vinted-fr-scraper',
    token: 'jeton-test',
    baseUrl: BASE,
    timeoutSecs: 600,
    sleep: async () => {},
    now,
  });

function apify(statuts: string[], items: unknown[], usage = 0.12) {
  const journal = { starts: [] as URL[], polls: 0, auth: new Set<string>(), body: null as unknown };
  let i = 0;
  server.use(
    http.post(`${BASE}/v2/acts/:actor/runs`, async ({ request, params }) => {
      journal.starts.push(new URL(request.url));
      journal.auth.add(request.headers.get('authorization') ?? '');
      journal.body = await request.json();
      expect(params['actor']).toBe('abotapi~vinted-fr-scraper');
      return HttpResponse.json({
        data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' },
      });
    }),
    http.get(`${BASE}/v2/actor-runs/run1`, ({ request }) => {
      journal.polls++;
      journal.auth.add(request.headers.get('authorization') ?? '');
      const status = statuts[Math.min(i++, statuts.length - 1)];
      return HttpResponse.json({
        data: { id: 'run1', status, defaultDatasetId: 'ds1', usageTotalUsd: usage },
      });
    }),
    http.get(`${BASE}/v2/datasets/ds1/items`, () => HttpResponse.json(items)),
  );
  return journal;
}

describe('ApifyAsyncRunner', () => {
  it('plafonds de PLATEFORME dans l’URL du run : maxItems, maxTotalChargeUsd, timeout, mémoire', async () => {
    const j = apify(['RUNNING', 'SUCCEEDED'], [{ id: 1 }, { id: 2 }]);
    const r = await runner().run({ mode: 'url' }, { maxItems: 2, maxTotalChargeUsd: 0.87 });
    const qs = j.starts[0]?.searchParams;
    expect(Object.fromEntries(qs ?? [])).toEqual({
      timeout: '600',
      memory: '1024',
      maxItems: '2',
      maxTotalChargeUsd: '0.87',
    });
    expect(j.body).toEqual({ mode: 'url' });
    expect(r).toEqual({
      runId: 'run1',
      statut: 'SUCCEEDED',
      coupe: false,
      items: [{ id: 1 }, { id: 2 }],
      usageTotalUsd: 0.12,
    });
    // Token uniquement en en-tête, jamais dans une URL.
    expect([...j.auth]).toEqual(['Bearer jeton-test']);
    expect(j.starts[0]?.toString()).not.toContain('jeton-test');
  });

  it('run en timeout : résultats partiels lus quand même, marqué « coupé »', async () => {
    apify(['RUNNING', 'TIMED-OUT'], [{ id: 1 }]);
    const r = await runner().run({}, { maxItems: 200, maxTotalChargeUsd: 0.87 });
    expect(r).toMatchObject({ statut: 'TIMED-OUT', coupe: true, items: [{ id: 1 }] });
  });

  it('plafonds absents ou invalides : refus AVANT tout appel', async () => {
    const j = apify(['SUCCEEDED'], []);
    await expect(runner().run({}, { maxItems: 0, maxTotalChargeUsd: 1 })).rejects.toThrow();
    await expect(runner().run({}, { maxItems: 1, maxTotalChargeUsd: 0 })).rejects.toThrow();
    expect(j.starts).toHaveLength(0);
  });

  it('démarrage en erreur 500 : JAMAIS relancé (pas de second run facturé)', async () => {
    let starts = 0;
    server.use(
      http.post(`${BASE}/v2/acts/:actor/runs`, () => {
        starts++;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    await expect(runner().run({}, { maxItems: 1, maxTotalChargeUsd: 0.1 })).rejects.toThrow(
      /indisponible/,
    );
    expect(starts).toBe(1);
  });

  it('démarrage refusé en 429 (aucun run créé) : relancé', async () => {
    let starts = 0;
    apify(['SUCCEEDED'], []);
    server.use(
      http.post(`${BASE}/v2/acts/:actor/runs`, () => {
        starts++;
        if (starts === 1) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json({
          data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' },
        });
      }),
    );
    const r = await runner().run({}, { maxItems: 1, maxTotalChargeUsd: 0.1 });
    expect(starts).toBe(2);
    expect(r.statut).toBe('SUCCEEDED');
  });

  it('run qui ne finit jamais : abandon demandé après timeout + 120 s, marqué « coupé »', async () => {
    let t = 0;
    let abort = 0;
    apify(['RUNNING'], []);
    server.use(
      http.post(`${BASE}/v2/actor-runs/run1/abort`, () => {
        abort++;
        return HttpResponse.json({ data: { id: 'run1', status: 'ABORTED' } });
      }),
    );
    const r = await runner(() => (t += 100_000)).run({}, { maxItems: 1, maxTotalChargeUsd: 0.1 });
    expect(abort).toBe(1);
    expect(r.coupe).toBe(true);
  });

  it('authentification refusée : erreur explicite, sans nouvelle tentative de lecture', async () => {
    server.use(
      http.post(`${BASE}/v2/acts/:actor/runs`, () => new HttpResponse(null, { status: 401 })),
    );
    await expect(runner().run({}, { maxItems: 1, maxTotalChargeUsd: 0.1 })).rejects.toThrow(
      /Authentification/,
    );
  });
});
