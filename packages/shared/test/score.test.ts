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

describe('computeScore — ratioBrut = margeNette / max(revente, 1 €)', () => {
  it('100 × (0,7 × clamp(ratioBrut) + 0,3 × vitesse)', () => {
    // 711 / 3000 = 0,237 → 0,7 × 0,237 = 16,6 points
    expect(computeScore(711, 3000, 0.5)).toBe(32);
    expect(computeScore(711, 3000, 1)).toBe(47);
    expect(computeScore(3000, 3000, 1)).toBe(100);
  });

  it('marge nette négative → part marge nulle', () => {
    expect(computeScore(-339, 3000, 0)).toBe(0);
    expect(computeScore(-339, 3000, 1)).toBe(30);
  });

  it('plancher du dénominateur à 1 € (revente nulle ou quasi nulle)', () => {
    expect(computeScore(0, 0, 0.5)).toBe(15);
    expect(computeScore(50, 0, 0.5)).toBe(50);
    expect(computeScore(50, 10, 0)).toBe(35);
  });

  it('annonce très bradée mais plombée par les frais → mauvais score', () => {
    // Revente 10 €, achat 1 € : décote brute de 90 %, mais frais + temps rendent la marge négative.
    const r = computeMargin({
      prixAchatCents: 100,
      prixReventeEstimeCents: 1000,
      classeColis: 'PETIT',
      preferences: {
        tauxHoraireCents: 1200,
        seuilMargeCents: 500,
        tempsEstimeMinutes: 20,
        coutEmballageCents: 50,
        modeVente: 'PARTICULIER',
      },
      medianJoursVente: null,
    });
    expect(r.margeNetteCents).toBe(-98);
    expect(r.score).toBe(15); // l'ancienne formule (revente − achat) / revente aurait donné 78
    expect(r.statut).toBe('ROUGE');
  });

  it('toujours un entier entre 0 et 100', () => {
    for (const [m, r, v] of [
      [1, 0, 2],
      [999, 1, -1],
      [12345, 678, 0.33],
      [-5000, 100, 0.9],
    ] as const) {
      const s = computeScore(m, r, v);
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
    expect(r.score).toBe(32);
  });

  it('high si délai de vente connu', () => {
    const r = computeMargin({ ...input, medianJoursVente: 3 });
    expect(r.confidence).toBe('high');
    expect(r.score).toBe(47);
  });
});
