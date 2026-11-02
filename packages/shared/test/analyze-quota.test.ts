import { describe, expect, it } from 'vitest';
import {
  analysisConsumesQuota,
  analysisResultSchema,
  analyzeListing,
  DEFAULT_PREFERENCES,
  FREE_MONTHLY_QUOTA,
  MESSAGE_DONNEES_INSUFFISANTES,
  normalizeListingUrl,
  quotaPeriod,
  remainingQuota,
  type AnalyzeInput,
  type PreviousAnalysis,
} from '../src/index.js';
import { NOW, ventes } from './fixtures.js';

const URL_ANNONCE = 'https://www.vinted.fr/items/123456-jean-levis';
const HEURE = 60 * 60 * 1000;

const input = (v: AnalyzeInput['ventes']): AnalyzeInput => ({
  listing: { prixCents: 1000, categorie: 'Jeans', marque: "Levi's", taille: 'M', etat: 'TRES_BON' },
  ventes: v,
  preferences: { ...DEFAULT_PREFERENCES },
  now: NOW,
});

describe('analyzeListing', () => {
  it('cas nominal : estimation + marge détaillée, payload valide', () => {
    const r = analyzeListing(input(ventes([3000, 3000, 3000, 3000, 3000])));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.estimate.prixReventeEstimeCents).toBe(3000);
    expect(r.margin.margeNetteCents).toBe(711);
    expect(r.margin.confidence).toBe('low');
    expect(() => analysisResultSchema.parse(r)).not.toThrow();
  });
});

describe('insufficient_data', () => {
  const r = analyzeListing(input(ventes([3000, 3000])));

  it('ne calcule aucune marge et renvoie le message utilisateur', () => {
    expect(r).toEqual({
      status: 'insufficient_data',
      message: MESSAGE_DONNEES_INSUFFISANTES,
      nbVentesTrouvees: 2,
      minVentesRequis: 5,
    });
    expect(r).not.toHaveProperty('margin');
    expect(r).not.toHaveProperty('estimate');
  });

  it('la payload est bien typée (schéma Zod partagé, aller-retour JSON)', () => {
    const parsed = analysisResultSchema.parse(JSON.parse(JSON.stringify(r)));
    expect(parsed.status).toBe('insufficient_data');
  });

  it('le schéma refuse une payload insufficient_data incomplète', () => {
    expect(analysisResultSchema.safeParse({ status: 'insufficient_data' }).success).toBe(false);
  });

  it('ne consomme pas de quota', () => {
    expect(analysisConsumesQuota(r, URL_ANNONCE, [], NOW)).toBe(false);
  });

  it('ne consomme pas de quota même quand le quota est épuisé', () => {
    const previous: PreviousAnalysis[] = Array.from({ length: FREE_MONTHLY_QUOTA }, (_, i) => ({
      url: `https://www.vinted.fr/items/${i}`,
      createdAt: new Date(NOW.getTime() - (i + 1) * HEURE),
      consommeQuota: true,
      served: true,
    }));
    expect(analysisConsumesQuota(r, URL_ANNONCE, previous, NOW)).toBe(false);
  });
});

describe('analysisConsumesQuota — réanalyse gratuite 24 h', () => {
  const ok = { status: 'ok' as const };
  const prev = (heuresAvant: number, served = true): PreviousAnalysis => ({
    url: `${URL_ANNONCE}?referrer=catalog#photos`,
    createdAt: new Date(NOW.getTime() - heuresAvant * HEURE),
    consommeQuota: true,
    served,
  });

  it('première analyse servie → consomme', () => {
    expect(analysisConsumesQuota(ok, URL_ANNONCE, [], NOW)).toBe(true);
  });
  it('même URL servie il y a 23 h → gratuite (query string ignorée)', () => {
    expect(analysisConsumesQuota(ok, URL_ANNONCE, [prev(23)], NOW)).toBe(false);
  });
  it('même URL servie il y a 25 h → consomme', () => {
    expect(analysisConsumesQuota(ok, URL_ANNONCE, [prev(25)], NOW)).toBe(true);
  });
  it('précédente analyse non servie (données insuffisantes) → consomme', () => {
    expect(analysisConsumesQuota(ok, URL_ANNONCE, [prev(1, false)], NOW)).toBe(true);
  });
});

describe('normalizeListingUrl', () => {
  it('ignore query, fragment, slash final et casse du domaine', () => {
    expect(normalizeListingUrl('https://WWW.Vinted.fr/items/1-a/?x=1#y')).toBe(
      'www.vinted.fr/items/1-a',
    );
  });
});

describe('remainingQuota', () => {
  it('FREE : 10 par mois, bloqué à la 11e', () => {
    expect(remainingQuota('FREE', 0)).toBe(10);
    expect(remainingQuota('FREE', 9)).toBe(1);
    expect(remainingQuota('FREE', 10)).toBe(0);
    expect(remainingQuota('FREE', 12)).toBe(0);
  });
  it('abonnés : illimité', () => {
    expect(remainingQuota('MONTHLY', 500)).toBeNull();
    expect(remainingQuota('ANNUAL', 500)).toBeNull();
  });
});

describe('quotaPeriod — mois civil heure de Paris', () => {
  it('novembre (UTC+1)', () => {
    const { start, end } = quotaPeriod(new Date('2026-11-02T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T23:00:00.000Z');
  });
  it('31 octobre 23h30 UTC est déjà en novembre à Paris', () => {
    expect(quotaPeriod(new Date('2026-10-31T23:30:00Z')).start.toISOString()).toBe(
      '2026-10-31T23:00:00.000Z',
    );
  });
  it('juillet (UTC+2)', () => {
    expect(quotaPeriod(new Date('2026-07-15T12:00:00Z')).start.toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
  });
  it('mars : début en heure d’hiver, fin en heure d’été', () => {
    const { start, end } = quotaPeriod(new Date('2026-03-15T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });
  it('décembre → janvier de l’année suivante', () => {
    expect(quotaPeriod(new Date('2026-12-10T12:00:00Z')).end.toISOString()).toBe(
      '2026-12-31T23:00:00.000Z',
    );
  });
});
