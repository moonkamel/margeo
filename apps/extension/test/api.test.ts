import { describe, expect, it } from 'vitest';
import { analysisResultSchema } from '../../../packages/shared/src/index.js';
import { analyserViaApi, maquettePour, maquettes } from '../src/lib/api.js';

const annonce = maquettes[0]!.annonce;
const cfg = { url: 'http://localhost:3000/', token: 'jeton-test', maquette: false };

describe('maquettes', () => {
  it('6 cas, tous conformes au contrat analysisResultSchema', () => {
    expect(maquettes.map((m) => m.cle)).toEqual([
      'vert',
      'orange',
      'rouge',
      'insuffisant',
      'confiance-basse',
      'erreur-reseau',
    ]);
    for (const m of maquettes)
      if (m.resultat) expect(() => analysisResultSchema.parse(m.resultat)).not.toThrow();
    const statuts = maquettes.map((m) =>
      m.resultat?.status === 'ok' ? m.resultat.margin.statut : null,
    );
    expect(statuts.slice(0, 3)).toEqual(['VERT', 'ORANGE', 'ROUGE']);
  });

  it('même annonce → même maquette', () => {
    expect(maquettePour(annonce)).toBe(maquettePour({ ...annonce }));
  });
});

describe('analyserViaApi (API réelle, fetch simulé)', () => {
  it('POST /analyze avec le token en en-tête et les seuls champs de l’annonce', async () => {
    const appels: { url: string; init: RequestInit }[] = [];
    const r = await analyserViaApi(annonce, {
      ...cfg,
      fetch: async (url, init) => {
        appels.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify(maquettes[0]!.resultat), { status: 200 });
      },
    });
    expect(r.ok).toBe(true);
    expect(appels[0]?.url).toBe('http://localhost:3000/analyze');
    expect((appels[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer jeton-test',
    );
    expect(JSON.parse(String(appels[0]?.init.body))).toEqual(annonce);
  });

  it('réseau en panne → erreur « reseau » ; HTTP 500 → « serveur » ; corps illisible → « serveur »', async () => {
    const panne = await analyserViaApi(annonce, {
      ...cfg,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(panne).toMatchObject({ ok: false, erreur: 'reseau' });
    const http500 = await analyserViaApi(annonce, {
      ...cfg,
      fetch: async () => new Response('x', { status: 500 }),
    });
    expect(http500).toMatchObject({ ok: false, erreur: 'serveur', detail: 'HTTP 500' });
    const illisible = await analyserViaApi(annonce, {
      ...cfg,
      fetch: async () => new Response('{"a":1}'),
    });
    expect(illisible).toMatchObject({ ok: false, erreur: 'serveur' });
  });
});
