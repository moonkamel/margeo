/**
 * Chaîne complète « taille absente » (abotapi sur vêtements, 0 / 5 tailles le 2026-11-04) :
 * payload sans taille → normalisation → seed (découverte, vente) → projection SoldObservation
 * → estimation au niveau (catégorie, marque), sans planter.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateResalePrice, type SoldSale } from '@margeo/shared';
import { normalizeVintedItem } from '../../src/index.js';
import {
  BrandResolver,
  budgetDepuisPlafond,
  runSeed,
  type DiscoveredListing,
  type SeedSource,
} from '../../src/seed/index.js';
import { cellule } from './fake-source.js';
import { MemoryRepo } from './memory-repo.js';

const P = JSON.parse(
  readFileSync(new URL('../fixtures/payloads-acteurs.json', import.meta.url), 'utf8'),
) as Record<'abotapiNike', Record<string, unknown>>;

/** Payload abotapi Sézane (catalogue 13, sous-catégorie 529) SANS clé `size`. */
function pullSansTaille(id: string, prix: number): Record<string, unknown> {
  const { size: _s, ...base } = P.abotapiNike;
  void _s;
  return {
    ...base,
    itemId: id,
    title: `Pull Sézane ${id}`,
    url: `https://www.vinted.fr/items/${id}-pull-sezane`,
    priceAmount: prix,
    brand: { id: '1', title: 'Sézane', slug: 'sezane' },
    brandTitle: 'Sézane',
    catalogId: '529',
    categoryId: '529',
    categoryPath: "Femmes Pulls d'hiver",
    condition: 'Très bon état',
  };
}

describe('taille absente : de l’acteur à l’estimation', () => {
  it('suivi, vente, puis estimation au niveau (catégorie, marque)', async () => {
    const SEZANE = cellule('Sweats et sweats à capuche (F)', 'Sézane', {
      catalogId: 13,
      cibleActives: 6,
    });
    const T0 = new Date('2026-11-10T05:00:00Z').getTime();
    let clock = T0;
    const prix = [40, 45, 50, 55, 60, 65];
    const bruts = prix.map((p, i) => pullSansTaille(`8000000${i}`, p));
    let vendu = false;
    const now = () => new Date(clock);
    const norm = (raw: unknown) => {
      const r = normalizeVintedItem(raw, now());
      if (!r.ok) throw new Error(r.detail);
      return r.listing;
    };
    const source: SeedSource = {
      async discover(_c, max) {
        const listings: DiscoveredListing[] = bruts
          .slice(0, max)
          .map((raw) => ({ listing: norm(raw), payload: raw, subcategoryId: 529 }));
        return { listings, resultatsFactures: listings.length };
      },
      async recheck(urls) {
        const results = urls.map((url) => {
          const raw = bruts.find((b) => b['url'] === url) as Record<string, unknown>;
          return {
            url,
            outcome: vendu ? ('sold' as const) : ('active' as const),
            listing: norm(raw),
            payload: raw,
          };
        });
        return { results, resultatsFactures: results.length };
      },
    };
    const repo = new MemoryRepo();
    const opts = {
      campagne: 'taille',
      cellules: [SEZANE],
      budget: budgetDepuisPlafond(10_000, 260, 5000),
      brandResolver: new BrandResolver(['Sézane'], []),
      source,
      repo,
      maxDecouverteParCellule: 6,
      now,
    };

    await runSeed(opts);
    expect([...repo.state.tracked.values()].map((t) => t.taille)).toEqual(Array(6).fill(null));

    clock += 24 * 3600_000;
    vendu = true;
    const r = await runSeed(opts);
    expect(r.ventesDetectees).toBe(6);

    const ventes: SoldSale[] = [...repo.state.ventes.values()].map((v) => ({
      prixVenteCents: v.prixVenteCents,
      etat: v.etat,
      categorie: v.categorie,
      marque: v.marque,
      taille: v.taille,
      soldAt: v.soldAt,
      listedAt: v.listedAt,
      source: v.source,
    }));
    expect(ventes.every((v) => v.taille === null)).toBe(true);

    // Annonce analysée : même cellule, taille absente elle aussi.
    const cible = norm(pullSansTaille('81', 50));
    expect(cible.taille).toBeNull();
    const e = estimateResalePrice(
      ventes,
      { categorie: SEZANE.categorie, marque: 'Sézane', taille: cible.taille, etat: 'TRES_BON' },
      now(),
    );
    expect(e.status).toBe('ok');
    if (e.status !== 'ok') return;
    // Phase 3 : 'categorie_marque' sera renommé 'marque' (section 8.5).
    expect(e.estimate.niveau).toBe('categorie_marque');

    // Même avec une taille connue sur l'annonce cible, les ventes sans taille ne forment pas
    // de niveau taille : repli (catégorie, marque), jamais de plantage.
    const avecTaille = estimateResalePrice(
      ventes,
      { categorie: SEZANE.categorie, marque: 'Sézane', taille: 'M', etat: 'TRES_BON' },
      now(),
    );
    expect(avecTaille.status === 'ok' && avecTaille.estimate.niveau).toBe('categorie_marque');
  });
});
