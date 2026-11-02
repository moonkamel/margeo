import { describe, expect, it } from 'vitest';
import { computeMargin, computeScore, computeVitesse } from '../src/index.js';

describe('computeVitesse', () => {
  it('sans données → vitesse 0,5 et confiance faible', () => {
    expect(computeVitesse(null)).toEqual({ vitesse: 0.5, confidence: 'low' });
  });

  it('bornes : ≤ 3 jours → 1, ≥ 30 jours → 0', () => {
    expect(computeVitesse(0).vitesse).toBe(1);
    expect(computeVitesse(3).vitesse).toBe(1);
    expect(computeVitesse(30).vitesse).toBe(0);
    expect(computeVitesse(90).vitesse).toBe(0);
  });

  it('interpolation linéaire et confiance élevée', () => {
    expect(computeVitesse(16.5)).toEqual({ vitesse: 0.5, confidence: 'high' });
  });
});

describe('computeScore', () => {
  it('100 × (0,7 × ratio + 0,3 × vitesse)', () => {
    expect(computeScore(3000, 1000, 0.5)).toBe(62);
    expect(computeScore(3000, 1000, 1)).toBe(77);
    expect(computeScore(3000, 0, 1)).toBe(100);
  });

  it('ratio borné à 0 quand l’achat dépasse la revente', () => {
    expect(computeScore(1000, 5000, 0)).toBe(0);
    expect(computeScore(1000, 5000, 1)).toBe(30);
  });

  it('revente nulle → pas de division par zéro', () => {
    expect(computeScore(0, 100, 0.5)).toBe(15);
  });

  it('toujours un entier entre 0 et 100', () => {
    for (const [r, a, v] of [
      [1, 0, 2],
      [999, 1, -1],
      [12345, 678, 0.33],
    ] as const) {
      const s = computeScore(r, a, v);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe('confidence dans la payload de marge', () => {
  const input = {
    prixAchatCents: 1000,
    prixReventeEstimeCents: 3000,
    classeColis: 'PETIT' as const,
    preferences: {
      tauxHoraireCents: 1200,
      seuilMargeCents: 500,
      tempsEstimeMinutes: 20,
      coutEmballageCents: 50,
      modeVente: 'PARTICULIER' as const,
    },
  };

  it('low si délai de vente inconnu', () => {
    const r = computeMargin({ ...input, medianJoursVente: null });
    expect(r.confidence).toBe('low');
    expect(r.vitesse).toBe(0.5);
    expect(r.score).toBe(62);
  });

  it('high si délai de vente connu', () => {
    const r = computeMargin({ ...input, medianJoursVente: 3 });
    expect(r.confidence).toBe('high');
    expect(r.score).toBe(77);
  });
});
