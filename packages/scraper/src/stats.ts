import { median, roundCents, type PriceStats, type SoldSale } from '@margeo/shared';

/**
 * Agrège des ventes observées en statistiques de prix.
 * Seules les ventes `sold_status` comptent dans les agrégats de prix ; les disparitions
 * sont conservées dans `ventes` (pour la vitesse) mais n'influencent ni médiane ni bornes.
 */
export function computePriceStats(
  query: { categorie: string; marque: string | null; taille: string | null },
  ventes: readonly SoldSale[],
  collecteAt: Date,
): PriceStats {
  const prix = ventes.filter((v) => v.source === 'sold_status').map((v) => v.prixVenteCents);
  return {
    ...query,
    ventes: [...ventes],
    nbVentes: prix.length,
    medianeCents: prix.length > 0 ? roundCents(median(prix)) : null,
    minCents: prix.length > 0 ? Math.min(...prix) : null,
    maxCents: prix.length > 0 ? Math.max(...prix) : null,
    collecteAt,
  };
}
