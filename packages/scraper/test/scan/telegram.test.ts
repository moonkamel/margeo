import { describe, expect, it } from 'vitest';
import {
  echapperHtml,
  messageAffaire,
  messageSynthese,
  notifierScan,
  TelegramError,
  type Affaire,
  type ScanResult,
} from '../../src/scan/index.js';

const TOKEN = '123456:FAUX-token-de-test';

const AFFAIRE: Affaire = {
  externalId: '101',
  url: 'https://www.vinted.fr/items/101-annonce',
  titre: 'Veste Carhartt Detroit <marron> & usée',
  modeleId: 'carhartt-detroit',
  modele: 'Detroit Jacket',
  marque: 'Carhartt',
  etat: 'TRES_BON',
  taille: 'M',
  prixCents: 1500,
  valeurReventeCents: 4960,
  margeNetteCents: 1840,
  score: 62,
  sourceCoefficient: 'initial',
  prixVerifie: false,
  nbVentesModele: 0,
  photoUrl: 'https://example.invalid/photo.webp',
  categorie: 'Hommes Vestes',
};

const resultat = (affaires: Affaire[], o: Partial<ScanResult> = {}): ScanResult => ({
  statut: 'COMPLETED',
  affaires,
  retenues: affaires.length,
  annoncesVues: 42,
  candidates: 7,
  parModele: {},
  categoriesObservees: {},
  depenseRunMilli: 21_000,
  depenseCampagneMilli: 21_000,
  alertes: [],
  ...o,
});

const DATE = new Date('2026-11-05T06:30:00Z');

type Appel = { methode: string; corps: Record<string, unknown> };
function fauxFetch(reponses: Record<string, { status: number; body: unknown }[]> = {}) {
  const appels: Appel[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const methode = String(url).split('/').pop() ?? '';
    appels.push({ methode, corps: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const r = reponses[methode]?.shift() ?? { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { f, appels };
}

describe('messages', () => {
  it('carte d’affaire : marge signée, revente, état, avertissements, HTML échappé', () => {
    const m = messageAffaire(AFFAIRE);
    expect(m).toContain('<b>+18,40');
    expect(m).toContain('&lt;marron&gt; &amp; usée');
    expect(m).toMatch(/Prix 15,00\s€ → revente estimée 49,60\s€ \(très bon état\)/);
    expect(m).toContain('Taille M · score 62/100');
    expect(m).toContain('prix neuf non vérifié');
    expect(m).toContain('authenticité');
    expect(m.length).toBeLessThanOrEqual(1024);
  });

  it('synthèse : nombre d’affaires, top N, dépense, alertes', () => {
    const m = messageSynthese(resultat([AFFAIRE], { retenues: 3, alertes: ['a < b'] }), DATE);
    expect(m).toContain('Margeo — 05/11');
    expect(m).toContain('1 affaire (top 1 sur 3)');
    expect(m).toMatch(/42 annonces vues, 7 détaillées\. Dépense 0,21\s€/);
    expect(m).toContain('⚠️ a &lt; b');
  });

  it('synthèse sans affaire', () => {
    expect(messageSynthese(resultat([]), DATE)).toContain('aucune affaire ce matin');
  });

  it('échappe le HTML', () => {
    expect(echapperHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });
});

describe('notifierScan', () => {
  it('envoie la synthèse puis une photo avec bouton vers l’annonce', async () => {
    const { f, appels } = fauxFetch();
    const r = await notifierScan(
      { token: TOKEN, chatId: '42', fetch: f },
      resultat([AFFAIRE]),
      DATE,
    );
    expect(appels.map((a) => a.methode)).toEqual(['sendMessage', 'sendPhoto']);
    expect(appels[1]?.corps).toMatchObject({
      chat_id: '42',
      photo: AFFAIRE.photoUrl,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Ouvrir sur Vinted', url: AFFAIRE.url }]] },
    });
    expect(r.notifies).toEqual(['101']);
  });

  it('photo refusée (400) : repli sur un message texte', async () => {
    const { f, appels } = fauxFetch({
      sendPhoto: [{ status: 400, body: { ok: false, description: 'Bad Request: wrong file' } }],
    });
    const r = await notifierScan(
      { token: TOKEN, chatId: '42', fetch: f },
      resultat([AFFAIRE]),
      DATE,
    );
    expect(appels.map((a) => a.methode)).toEqual(['sendMessage', 'sendPhoto', 'sendMessage']);
    expect(r.notifies).toEqual(['101']);
  });

  it('sans photo : message texte directement', async () => {
    const { f, appels } = fauxFetch();
    await notifierScan(
      { token: TOKEN, chatId: '42', fetch: f },
      resultat([{ ...AFFAIRE, photoUrl: null }]),
      DATE,
    );
    expect(appels.map((a) => a.methode)).toEqual(['sendMessage', 'sendMessage']);
  });

  it('erreur : ne contient jamais le token', async () => {
    const { f } = fauxFetch({
      sendMessage: [{ status: 401, body: { ok: false, description: `Unauthorized ${TOKEN}` } }],
    });
    const err = await notifierScan(
      { token: TOKEN, chatId: '42', fetch: f },
      resultat([]),
      DATE,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(String((err as Error).message)).not.toContain('FAUX-token');
  });

  it('erreur réseau : ne relaie pas le message (qui peut contenir l’URL)', async () => {
    const f = (async (url: string | URL | Request) => {
      throw new TypeError(`fetch failed ${String(url)}`);
    }) as typeof fetch;
    const err = await notifierScan(
      { token: TOKEN, chatId: '42', fetch: f },
      resultat([]),
      DATE,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });
});
