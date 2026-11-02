import { describe, expect, it } from 'vitest';
import {
  estimateResalePrice,
  median,
  priceEstimateSchema,
  type EstimationTarget,
} from '../src/index.js';
import { NOW, vente, ventes } from './fixtures.js';

const cible: EstimationTarget = {
  categorie: 'Jeans',
  marque: "Levi's",
  taille: 'M',
  etat: 'TRES_BON',
};

const ok = (o: ReturnType<typeof estimateResalePrice>) => {
  if (o.status !== 'ok') throw new Error(`attendu ok, reçu ${o.status}`);
  return o.estimate;
};

describe('median', () => {
  it('effectif impair / pair', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('liste vide → erreur', () => {
    expect(() => median([])).toThrow();
  });
});

describe('estimateResalePrice — médiane empirique', () => {
  it('médiane des ventes de la cellule la plus précise, même état', () => {
    const e = ok(estimateResalePrice(ventes([1000, 1200, 1500, 1800, 2000]), cible, NOW));
    expect(e).toMatchObject({
      prixReventeEstimeCents: 1500,
      medianeCents: 1500,
      nbVentes: 5,
      niveau: 'categorie_marque_taille',
      source: 'empirical',
      multiplicateurEtat: 1,
      minCents: 1000,
      maxCents: 2000,
      fenetreJours: 30,
    });
    expect(() => priceEstimateSchema.parse(e)).not.toThrow();
  });

  it('insensible à la casse et aux espaces', () => {
    const data = ventes([1000, 1000, 1000, 1000, 1000], {
      categorie: ' jeans ',
      marque: "LEVI'S",
      taille: 'm',
    });
    expect(ok(estimateResalePrice(data, cible, NOW)).niveau).toBe('categorie_marque_taille');
  });
});

describe('estimateResalePrice — fenêtre et sources', () => {
  it('ignore les ventes hors fenêtre de 30 jours', () => {
    const data = [...ventes([1000, 1000, 1000, 1000]), vente({ prix: 9000, joursAvant: 31 })];
    expect(estimateResalePrice(data, { ...cible, marque: null }, NOW).status).toBe(
      'insufficient_data',
    );
  });

  it('ignore les ventes futures (horodatage incohérent)', () => {
    const data = [...ventes([1000, 1000, 1000, 1000]), vente({ prix: 1000, joursAvant: -1 })];
    expect(estimateResalePrice(data, cible, NOW).status).toBe('insufficient_data');
  });

  it('les disparitions ne comptent pas dans la médiane de prix', () => {
    const data = [
      ...ventes([1000, 1000, 1000, 1000]),
      ...ventes([5000, 5000, 5000], { source: 'disappeared' }),
    ];
    expect(estimateResalePrice(data, cible, NOW).status).toBe('insufficient_data');
  });
});

describe('estimateResalePrice — repli hiérarchique', () => {
  it('(cat, marque, taille) insuffisant → (cat, marque)', () => {
    const data = [
      ...ventes([1000, 1000], { taille: 'M' }),
      ...ventes([2000, 2000, 2000], { taille: 'L' }),
    ];
    const e = ok(estimateResalePrice(data, cible, NOW));
    expect(e.niveau).toBe('categorie_marque');
    expect(e.prixReventeEstimeCents).toBe(2000);
  });

  it('(cat, marque) insuffisant → (cat)', () => {
    const data = [...ventes([1000, 1000]), ...ventes([3000, 3000, 3000], { marque: 'Diesel' })];
    const e = ok(estimateResalePrice(data, cible, NOW));
    expect(e.niveau).toBe('categorie');
    expect(e.nbVentes).toBe(5);
  });

  it('marque inconnue sur l’annonce → passe directement au niveau catégorie', () => {
    const data = ventes([1000, 1100, 1200, 1300, 1400], { marque: 'Diesel' });
    expect(ok(estimateResalePrice(data, { ...cible, marque: null }, NOW)).niveau).toBe('categorie');
  });

  it('ne mélange jamais les catégories', () => {
    const data = ventes([1000, 1000, 1000, 1000, 1000], { categorie: 'Robes' });
    expect(estimateResalePrice(data, cible, NOW).status).toBe('insufficient_data');
  });
});

describe('estimateResalePrice — état', () => {
  it('≥ 5 ventes dans l’état visé → médiane empirique de cet état', () => {
    const data = [
      ...ventes([3000, 3000, 3000, 3000, 3000], { etat: 'NEUF_AVEC_ETIQUETTE' }),
      ...ventes([1000, 1000, 1000]),
    ];
    const e = ok(estimateResalePrice(data, { ...cible, etat: 'NEUF_AVEC_ETIQUETTE' }, NOW));
    expect(e.source).toBe('empirical');
    expect(e.prixReventeEstimeCents).toBe(3000);
  });

  it('< 5 ventes dans l’état visé → multiplicateur de repli affiché comme tel', () => {
    const e = ok(
      estimateResalePrice(ventes([1000, 1000, 1000, 1000, 1000]), { ...cible, etat: 'BON' }, NOW),
    );
    expect(e.source).toBe('fallback');
    expect(e.multiplicateurEtat).toBe(0.85);
    expect(e.prixReventeEstimeCents).toBe(850);
  });

  it('repli : les ventes sont ramenées en équivalent « très bon » avant la médiane', () => {
    // 5 ventes « bon état » à 850 € → équivalent très bon 1000 → neuf avec étiquette : 1150.
    const data = ventes([850, 850, 850, 850, 850], { etat: 'BON' });
    const e = ok(estimateResalePrice(data, { ...cible, etat: 'NEUF_AVEC_ETIQUETTE' }, NOW));
    expect(e.medianeCents).toBe(1000);
    expect(e.prixReventeEstimeCents).toBe(1150);
  });

  it('valeurs de repli validées pour les 5 états', () => {
    const attendus = {
      NEUF_AVEC_ETIQUETTE: 1.15,
      NEUF_SANS_ETIQUETTE: 1.05,
      BON: 0.85,
      SATISFAISANT: 0.7,
    } as const;
    for (const [etat, m] of Object.entries(attendus)) {
      const e = ok(
        estimateResalePrice(
          ventes([1000, 1000, 1000, 1000, 1000]),
          { ...cible, etat: etat as keyof typeof attendus },
          NOW,
        ),
      );
      expect(e.multiplicateurEtat).toBe(m);
    }
  });
});

describe('estimateResalePrice — délai de vente', () => {
  it('médiane des délais quand ≥ 5 délais connus, disparitions incluses', () => {
    const data = [
      ...ventes([1000, 1000, 1000], { delaiJours: 4 }),
      ...ventes([1000, 1000], { delaiJours: 10, source: 'disappeared' }),
      ...ventes([1000, 1000], { delaiJours: 10 }),
    ];
    expect(ok(estimateResalePrice(data, cible, NOW)).medianJoursVente).toBe(10);
  });

  it('délai inconnu → null', () => {
    expect(
      ok(estimateResalePrice(ventes([1000, 1000, 1000, 1000, 1000]), cible, NOW)).medianJoursVente,
    ).toBeNull();
  });
});

describe('estimateResalePrice — données insuffisantes', () => {
  it('aucune vente → insufficient_data, aucun prix inventé', () => {
    expect(estimateResalePrice([], cible, NOW)).toEqual({
      status: 'insufficient_data',
      nbVentesTrouvees: 0,
      minVentesRequis: 5,
    });
  });

  it('4 ventes au niveau le plus large → insufficient_data', () => {
    const o = estimateResalePrice(ventes([1000, 1000, 1000, 1000]), cible, NOW);
    expect(o).toEqual({ status: 'insufficient_data', nbVentesTrouvees: 4, minVentesRequis: 5 });
  });
});
