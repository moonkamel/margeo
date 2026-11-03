import { describe, expect, it } from 'vitest';
import {
  analysisResultSchema,
  analyzeListing,
  DEFAULT_PREFERENCES,
  MESSAGE_DONNEES_INSUFFISANTES,
  type AnalyzeInput,
} from '../src/index.js';
import { NOW, ventes } from './fixtures.js';

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
});
