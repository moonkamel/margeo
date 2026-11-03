import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyserAnnonceModele,
  coefficientModele,
  estimerDepuisPrixNeuf,
  lireModelesCibles,
  modelesActifs,
  normaliserTexte,
  prixMaxAchatCents,
  reconnaitreModele,
  type ModeleCible,
  type VenteModele,
} from '../src/index.js';

const fichier = JSON.parse(
  readFileSync(new URL('../data/target-models.json', import.meta.url), 'utf8'),
) as unknown;
const MODELES = lireModelesCibles(fichier);
const parId = (id: string) => {
  const m = MODELES.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return m;
};
const DETROIT = parId('carhartt-detroit');

describe('target-models.json', () => {
  it('est valide : coefficients 0,05–0,9, prix > 0, source renseignée, ids uniques', () => {
    expect(MODELES.length).toBeGreaterThanOrEqual(4);
    for (const m of MODELES) {
      expect(m.coefficientInitial).toBeGreaterThanOrEqual(0.05);
      expect(m.coefficientInitial).toBeLessThanOrEqual(0.9);
      expect(m.prixNeufCents).toBeGreaterThan(0);
      expect(m.sourcePrix.length).toBeGreaterThan(5);
    }
  });

  it('Carhartt seul est actif ; la réserve n’est pas scannée', () => {
    const actifs = modelesActifs(MODELES).map((m) => m.id);
    expect(actifs).toEqual([
      'carhartt-detroit',
      'carhartt-active',
      'carhartt-crawford',
      'carhartt-wip-og-detroit',
    ]);
    expect(MODELES.length).toBeGreaterThan(actifs.length);
  });

  it('exige un catalogue pour un modèle actif, pas pour un modèle en réserve', () => {
    const base = fichier as { version: 1; modeles: Record<string, unknown>[] };
    const m0 = base.modeles[0] as Record<string, unknown>;
    const sansCatalogue = { ...m0, catalogId: null, catalogPath: [] };
    expect(() => lireModelesCibles({ ...base, modeles: [sansCatalogue] })).toThrow(/catalogue/);
    expect(
      lireModelesCibles({ ...base, modeles: [{ ...sansCatalogue, actif: false }] }),
    ).toHaveLength(1);
  });

  it('coefficients de la réserve prudents (≤ 0,45)', () => {
    for (const m of MODELES.filter((x) => !x.actif))
      expect(m.coefficientInitial).toBeLessThanOrEqual(0.45);
  });

  it('signale les prix non vérifiés comme estimations', () => {
    for (const m of MODELES.filter((x) => !x.prixVerifie)) {
      expect(m.sourcePrix).toMatch(/estimation/);
    }
  });

  it('refuse un champ inconnu, un coefficient hors bornes et un id en double', () => {
    const base = fichier as { version: 1; modeles: Record<string, unknown>[] };
    const m0 = base.modeles[0] as Record<string, unknown>;
    expect(() => lireModelesCibles({ ...base, modeles: [{ ...m0, inconnu: 1 }] })).toThrow();
    expect(() =>
      lireModelesCibles({ ...base, modeles: [{ ...m0, coefficientInitial: 1.2 }] }),
    ).toThrow();
    expect(() => lireModelesCibles({ ...base, modeles: [m0, m0] })).toThrow(/double/);
  });
});

describe('reconnaitreModele', () => {
  const r = (
    titre: string,
    marque: string | null = titre.match(/patagonia/i)
      ? 'Patagonia'
      : titre.match(/north face/i)
        ? 'The North Face'
        : 'Carhartt',
  ) => reconnaitreModele(titre, marque, MODELES)?.modele.id ?? null;

  it.each([
    ['Veste Carhartt Detroit marron taille M', 'carhartt-detroit'],
    ['CARHARTT DETROIT JACKET J97 vintage', 'carhartt-detroit'],
    ['Carhartt détroit blanket lined', 'carhartt-detroit'],
    ['carhartt j97 brown duck', 'carhartt-detroit'],
    ['Carhartt Crawford Detroit noir', 'carhartt-crawford'],
    ['Carhartt Active Jacket J130 duck', 'carhartt-active'],
    ['Carhartt active hooded jacket', 'carhartt-active'],
    ['Patagonia Retro-X fleece', 'patagonia-retro-x'],
    ['Polaire The North Face Denali', 'tnf-denali'],
  ])('%s → %s', (titre, attendu) => {
    expect(r(titre)).toBe(attendu);
  });

  it('distingue Carhartt et Carhartt WIP', () => {
    expect(r('Carhartt WIP OG Detroit Jacket', 'Carhartt WIP')).toBe('carhartt-wip-og-detroit');
    // Une Detroit WIP n'est pas la Detroit Carhartt (prix neuf différent) : non reconnue.
    expect(r('Carhartt WIP Detroit Jacket', 'Carhartt WIP')).toBeNull();
    expect(r('Carhartt OG Detroit', 'Carhartt')).toBe('carhartt-detroit');
  });

  it('écarte les imitations et les titres sans modèle', () => {
    expect(r('Veste style Detroit Carhartt')).toBeNull();
    expect(r('Veste type Carhartt Detroit')).toBeNull();
    expect(r('Veste façon Detroit')).toBeNull();
    expect(r('Veste Carhartt marron')).toBeNull();
    // « active » seul ne suffit pas.
    expect(r('Carhartt active wear hoodie')).toBeNull();
  });

  it('compare en mots entiers', () => {
    expect(r('Carhartt streetstyle Detroit')).toBe('carhartt-detroit');
    expect(r('Carhartt Detroitjacket')).toBeNull();
  });

  it('exige la marque de l’annonce', () => {
    expect(r('Veste Detroit Carhartt', null)).toBeNull();
    expect(r('Veste Detroit Carhartt', 'Dickies')).toBeNull();
  });

  it('normalise accents, casse et ponctuation', () => {
    expect(normaliserTexte('  Détroit-JACKET, (J97)! ')).toBe('detroit jacket j97');
  });
});

describe('coefficient et estimation', () => {
  const ventes = (prix: number[]): VenteModele[] =>
    prix.map((p) => ({ prixVenteCents: p, etat: 'TRES_BON' }));

  it('moins de 3 ventes : coefficient initial', () => {
    expect(coefficientModele(DETROIT, ventes([9000, 9000]))).toEqual({
      coefficient: 0.32,
      source: 'initial',
    });
  });

  it('3 à 9 ventes : moyenne initial / observé', () => {
    const c = coefficientModele(DETROIT, ventes([6200, 6200, 6200]));
    expect(c.source).toBe('mixte');
    expect(c.coefficient).toBeCloseTo(0.5 * 0.32 + 0.5 * (6200 / 15500), 6);
  });

  it('10 ventes et plus : observé seul', () => {
    const c = coefficientModele(DETROIT, ventes(Array.from({ length: 10 }, () => 7750)));
    expect(c).toEqual({ coefficient: 0.5, source: 'observe' });
  });

  it('ramène chaque vente à son équivalent très bon état', () => {
    // 8,50 € en BON (× 0,85) = 10,00 € en très bon état.
    const v: VenteModele[] = Array.from({ length: 10 }, () => ({
      prixVenteCents: 850,
      etat: 'BON',
    }));
    expect(coefficientModele({ ...DETROIT, prixNeufCents: 1000 }, v).coefficient).toBeCloseTo(1, 6);
  });

  it('applique le multiplicateur d’état', () => {
    expect(estimerDepuisPrixNeuf(DETROIT, 'TRES_BON').valeurReventeCents).toBe(4960);
    expect(estimerDepuisPrixNeuf(DETROIT, 'BON').valeurReventeCents).toBe(4216);
    expect(estimerDepuisPrixNeuf(DETROIT, 'NEUF_AVEC_ETIQUETTE').valeurReventeCents).toBe(5704);
  });

  it('prix d’achat maximal = revente dans le meilleur état', () => {
    expect(prixMaxAchatCents(DETROIT)).toBe(5704);
  });
});

describe('analyserAnnonceModele', () => {
  it('une Detroit très bon état à 15 € : marge positive, confiance faible', () => {
    const { estimation, margin } = analyserAnnonceModele(DETROIT, {
      prixCents: 1500,
      etat: 'TRES_BON',
    });
    expect(estimation.valeurReventeCents).toBe(4960);
    expect(margin.margeNetteCents).toBeGreaterThan(1000);
    expect(margin.statut).toBe('VERT');
    expect(margin.confidence).toBe('low');
  });

  it('une Detroit au prix du marché (50 €) : pas une affaire', () => {
    const { margin } = analyserAnnonceModele(DETROIT, { prixCents: 5000, etat: 'TRES_BON' });
    expect(margin.margeNetteCents).toBeLessThan(0);
    expect(margin.statut).toBe('ROUGE');
  });

  it('utilise la classe de colis du modèle', () => {
    const petit: ModeleCible = { ...DETROIT, classeColis: 'PETIT' };
    const a = analyserAnnonceModele(DETROIT, { prixCents: 1500, etat: 'TRES_BON' });
    const b = analyserAnnonceModele(petit, { prixCents: 1500, etat: 'TRES_BON' });
    expect(a.margin.margeNetteCents).toBeLessThan(b.margin.margeNetteCents);
  });
});
