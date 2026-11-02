import type { Etat, SoldSale } from '../src/index.js';

export const NOW = new Date('2026-11-02T12:00:00Z');
const JOUR = 24 * 60 * 60 * 1000;

export function vente(
  overrides: Partial<SoldSale> & { prix: number; joursAvant?: number; delaiJours?: number },
): SoldSale {
  const { prix, joursAvant = 1, delaiJours, ...rest } = overrides;
  const soldAt = new Date(NOW.getTime() - joursAvant * JOUR);
  return {
    prixVenteCents: prix,
    etat: 'TRES_BON' as Etat,
    categorie: 'Jeans',
    marque: "Levi's",
    taille: 'M',
    soldAt,
    listedAt: delaiJours === undefined ? null : new Date(soldAt.getTime() - delaiJours * JOUR),
    source: 'sold_status',
    ...rest,
  };
}

export function ventes(
  prix: readonly number[],
  overrides: Partial<SoldSale> & { delaiJours?: number } = {},
): SoldSale[] {
  return prix.map((p) => vente({ prix: p, ...overrides }));
}
