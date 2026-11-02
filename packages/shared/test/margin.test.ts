import { describe, expect, it } from 'vitest';
import {
  BAREME_VINTED,
  computeFraisVinted,
  computeMargin,
  computeStatut,
  computeValorisationTemps,
  isModeVenteDisponible,
  marginResultSchema,
  type MarginInput,
  type Preferences,
} from '../src/index.js';

const prefs: Preferences = {
  tauxHoraireCents: 1200,
  seuilMargeCents: 500,
  tempsEstimeMinutes: 20,
  coutEmballageCents: 50,
  modeVente: 'PARTICULIER',
};

const base: MarginInput = {
  prixAchatCents: 1000,
  prixReventeEstimeCents: 3000,
  classeColis: 'PETIT',
  preferences: prefs,
  medianJoursVente: null,
};

const ligne = (r: ReturnType<typeof computeMargin>, cle: string) =>
  r.lignes.find((l) => l.cle === cle)?.montantCents;

describe('computeMargin — formule ligne par ligne', () => {
  it('applique exactement la formule sur un cas de référence', () => {
    const r = computeMargin(base);
    // Revente 30 € − achat 10 € − protection (0,70 + 5 % × 10 €) − port 3,50 €
    // − emballage 0,50 € − cotisations 12,3 % × 30 € − temps 20 min à 12 €/h
    expect(ligne(r, 'prix_revente')).toBe(3000);
    expect(ligne(r, 'prix_achat')).toBe(-1000);
    expect(ligne(r, 'frais_vinted')).toBe(-120);
    expect(ligne(r, 'frais_port')).toBe(-350);
    expect(ligne(r, 'emballage')).toBe(-50);
    expect(ligne(r, 'cotisations')).toBe(-369);
    expect(ligne(r, 'temps')).toBe(-400);
    expect(r.margeNetteCents).toBe(711);
    expect(r.statut).toBe('VERT');
  });

  it('la somme des lignes est égale à la marge nette', () => {
    for (const achat of [0, 1, 999, 1500, 2999, 10_000]) {
      const r = computeMargin({ ...base, prixAchatCents: achat });
      const somme = r.lignes.reduce((acc, l) => acc + l.montantCents, 0);
      expect(somme).toBe(r.margeNetteCents);
    }
  });

  it('les lignes respectent l’ordre d’affichage attendu', () => {
    expect(computeMargin(base).lignes.map((l) => l.cle)).toEqual([
      'prix_revente',
      'prix_achat',
      'frais_vinted',
      'frais_port',
      'emballage',
      'cotisations',
      'temps',
    ]);
  });

  it('inclut explicitement les cotisations à 12,3 % du prix de revente', () => {
    const r = computeMargin({ ...base, prixReventeEstimeCents: 10_000 });
    expect(ligne(r, 'cotisations')).toBe(-1230);
  });

  it('produit des montants entiers (centimes) même avec des taux décimaux', () => {
    const r = computeMargin({
      ...base,
      prixAchatCents: 333,
      prixReventeEstimeCents: 1777,
      preferences: { ...prefs, tempsEstimeMinutes: 7 },
    });
    for (const l of r.lignes) expect(Number.isInteger(l.montantCents)).toBe(true);
    expect(Number.isInteger(r.margeNetteCents)).toBe(true);
  });

  it('le résultat est conforme au schéma Zod partagé', () => {
    expect(() => marginResultSchema.parse(computeMargin(base))).not.toThrow();
  });

  it('marque les lignes éditables inline (temps, taux horaire, emballage)', () => {
    const r = computeMargin(base);
    expect(r.lignes.find((l) => l.cle === 'temps')?.editable).toEqual([
      'tempsEstimeMinutes',
      'tauxHoraireCents',
    ]);
    expect(r.lignes.find((l) => l.cle === 'emballage')?.editable).toEqual(['coutEmballageCents']);
  });

  it('est pure : mêmes entrées → même sortie, entrées non mutées', () => {
    const input = structuredClone(base);
    expect(computeMargin(input)).toEqual(computeMargin(input));
    expect(input).toEqual(base);
  });
});

describe('computeMargin — recalcul client sur changement de préférences', () => {
  it('un taux horaire plus élevé réduit la marge du delta de valorisation du temps', () => {
    const avant = computeMargin(base);
    const apres = computeMargin({ ...base, preferences: { ...prefs, tauxHoraireCents: 3000 } });
    expect(ligne(apres, 'temps')).toBe(-1000);
    expect(apres.margeNetteCents).toBe(avant.margeNetteCents - 600);
    expect(apres.statut).toBe('ORANGE');
  });

  it('modifier le coût d’emballage met à jour la marge', () => {
    const r = computeMargin({ ...base, preferences: { ...prefs, coutEmballageCents: 200 } });
    expect(r.margeNetteCents).toBe(711 - 150);
  });

  it('un temps nul donne une valorisation nulle', () => {
    const r = computeMargin({ ...base, preferences: { ...prefs, tempsEstimeMinutes: 0 } });
    expect(ligne(r, 'temps')).toBe(0);
    expect(r.margeNetteCents).toBe(711 + 400);
    expect(r.statut).toBe('VERT');
  });
});

describe('computeMargin — modes de vente', () => {
  it('PARTICULIER : aucune commission vendeur', () => {
    expect(
      computeFraisVinted(1000, 3000, { modeVente: 'PARTICULIER' }).commissionVendeurCents,
    ).toBe(0);
  });

  it('PRO : commission vendeur forfaitaire de 5 € par vente, indépendante du prix', () => {
    for (const revente of [1000, 3000, 20_000]) {
      const pro = computeFraisVinted(1000, revente, { modeVente: 'PRO' });
      expect(pro.commissionVendeurCents).toBe(500);
    }
    const r = computeMargin({ ...base, preferences: { ...prefs, modeVente: 'PRO' } });
    expect(ligne(r, 'frais_vinted')).toBe(-(120 + 500));
    expect(r.margeNetteCents).toBe(711 - 500);
    expect(r.lignes.find((l) => l.cle === 'frais_vinted')?.detail).toContain('à confirmer');
  });

  it('les deux modes sont marqués non vérifiés ; PRO n’est pas exposé dans l’UI', () => {
    expect(BAREME_VINTED.modes.PARTICULIER.verifie).toBe(false);
    expect(BAREME_VINTED.modes.PRO.verifie).toBe(false);
    expect(isModeVenteDisponible('PARTICULIER')).toBe(true);
    expect(isModeVenteDisponible('PRO')).toBe(false);
    const verifie = {
      ...BAREME_VINTED,
      modes: { ...BAREME_VINTED.modes, PRO: { ...BAREME_VINTED.modes.PRO, verifie: true } },
    };
    expect(isModeVenteDisponible('PRO', verifie)).toBe(true);
  });

  it('le port dépend du format de colis', () => {
    const petit = computeMargin(base);
    const grand = computeMargin({ ...base, classeColis: 'GRAND' });
    expect(petit.margeNetteCents - grand.margeNetteCents).toBe(
      BAREME_VINTED.portAchatCents.GRAND - BAREME_VINTED.portAchatCents.PETIT,
    );
  });
});

describe('statut', () => {
  it('VERT / ORANGE / ROUGE selon les seuils', () => {
    expect(computeMargin(base).statut).toBe('VERT');
    expect(computeMargin({ ...base, prixAchatCents: 1500 }).margeNetteCents).toBe(186);
    expect(computeMargin({ ...base, prixAchatCents: 1500 }).statut).toBe('ORANGE');
    expect(computeMargin({ ...base, prixAchatCents: 2000 }).margeNetteCents).toBe(-339);
    expect(computeMargin({ ...base, prixAchatCents: 2000 }).statut).toBe('ROUGE');
  });

  it('marge nulle → ROUGE ; marge = seuil → VERT ; juste sous le seuil → ORANGE', () => {
    expect(computeStatut(0, 500)).toBe('ROUGE');
    expect(computeStatut(-1, 500)).toBe('ROUGE');
    expect(computeStatut(500, 500)).toBe('VERT');
    expect(computeStatut(499, 500)).toBe('ORANGE');
    expect(computeStatut(1, 500)).toBe('ORANGE');
  });

  it('le statut ne dépend que de la marge nette et du seuil (aucun gate horaire)', () => {
    // Taux horaire très élevé : seul son effet sur margeNette (ligne temps) compte.
    const r = computeMargin({
      ...base,
      prixReventeEstimeCents: 100_000,
      preferences: { ...prefs, tauxHoraireCents: 50_000, tempsEstimeMinutes: 60 },
    });
    expect(r.margeNetteCents).toBeGreaterThanOrEqual(prefs.seuilMargeCents);
    expect(r.statut).toBe('VERT');
  });

  it('aucune variable margeHoraire dans le retour', () => {
    const r = computeMargin(base);
    expect(Object.keys(r).some((k) => /horaire/i.test(k))).toBe(false);
    expect(r).not.toHaveProperty('margeHoraireCents');
    expect(r).not.toHaveProperty('margeHoraire');
    // Le schéma strict refuse toute réintroduction côté payload.
    expect(marginResultSchema.safeParse({ ...r, margeHoraireCents: 0 }).success).toBe(false);
  });
});

describe('computeValorisationTemps', () => {
  it('(minutes / 60) × taux horaire, arrondi au centime', () => {
    expect(computeValorisationTemps(20, 1200)).toBe(400);
    expect(computeValorisationTemps(7, 1000)).toBe(117);
    expect(computeValorisationTemps(0, 1500)).toBe(0);
  });
});
