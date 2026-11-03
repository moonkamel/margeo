import { describe, expect, it } from 'vitest';
import {
  analysisResultSchema,
  analyzeListing,
  analyzeRequestSchema,
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

describe('analyzeRequestSchema — contrat POST /analyze (lecture sur la page)', () => {
  const ok = {
    externalId: '4817263512',
    url: 'https://www.vinted.fr/items/4817263512-pull-sezane',
    titre: 'Pull Sézane en laine',
    prixCents: 3500,
    marque: 'Sézane',
    taille: 'M',
    etat: 'Très bon état',
    categorie: 'Femmes > Vêtements > Pulls',
  };

  it('accepte les champs minimaux lus sur la page', () => {
    expect(analyzeRequestSchema.parse(ok)).toEqual(ok);
    expect(
      analyzeRequestSchema.parse({ ...ok, taille: null, etat: null, categorie: null }).taille,
    ).toBeNull();
  });

  it('titre, prix et marque obligatoires (règle A : pas de résultat partiel)', () => {
    for (const champ of ['titre', 'prixCents', 'marque'] as const) {
      const { [champ]: _retire, ...sans } = ok;
      void _retire;
      expect(analyzeRequestSchema.safeParse(sans).success).toBe(false);
    }
  });

  it('aucun champ supplémentaire (description, vendeur, photos refusés)', () => {
    for (const extra of [{ description: 'x' }, { vendeur: 'x' }, { photos: [] }]) {
      expect(analyzeRequestSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });

  it('identifiant numérique, prix entier positif', () => {
    expect(analyzeRequestSchema.safeParse({ ...ok, externalId: 'abc' }).success).toBe(false);
    expect(analyzeRequestSchema.safeParse({ ...ok, prixCents: 0 }).success).toBe(false);
    expect(analyzeRequestSchema.safeParse({ ...ok, prixCents: 12.5 }).success).toBe(false);
  });
});
