import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { lireModelesCibles, modelesActifs, type ModeleCible } from '@margeo/shared';
import {
  apercuDepuisRecherche,
  budgetScan,
  runScan,
  SCAN_PLAFOND_CENTS,
  type ScanOptions,
  type ScanSource,
} from '../../src/scan/index.js';

const MODELES = lireModelesCibles(
  JSON.parse(
    readFileSync(new URL('../../../shared/data/target-models.json', import.meta.url), 'utf8'),
  ),
);
const P = JSON.parse(
  readFileSync(new URL('../fixtures/payloads-acteurs.json', import.meta.url), 'utf8'),
) as { abotapiNike: Record<string, unknown> };

/** Payload abotapi fictif (données de forme réelle, contenu inventé). */
function item(
  id: string,
  titre: string,
  prix: number,
  o: { marque?: string; etat?: string; categorie?: string } = {},
): Record<string, unknown> {
  const marque = o.marque ?? 'Carhartt';
  return {
    ...P.abotapiNike,
    itemId: id,
    title: titre,
    url: `https://www.vinted.fr/items/${id}-annonce`,
    path: `/items/${id}-annonce`,
    priceAmount: prix,
    brand: { id: '1', title: marque, slug: 'x' },
    brandTitle: marque,
    brandId: '1',
    condition: o.etat ?? 'Très bon état',
    size: 'M',
    catalogId: '2052',
    categoryId: '2052',
    categoryPath: o.categorie ?? 'Hommes Vestes',
    category: o.categorie ?? 'Hommes Vestes',
  };
}

const A = item('101', 'Veste Carhartt Detroit marron', 15);
const STYLE = item('102', 'Veste style Detroit Carhartt', 10);
const DICKIES = item('103', 'Veste Detroit', 12, { marque: 'Dickies' });
const CHERE = item('104', 'Carhartt Detroit J97', 70);
const CRAWFORD = item('105', 'Carhartt Crawford Detroit noir', 12);
const DEJA = item('106', 'Carhartt Detroit jacket', 14);
const MARCHE = item('107', 'Carhartt Detroit', 45);

function source(
  parModele: Record<string, unknown[]>,
  o: { detailsCoupe?: boolean; rechercheEchoue?: string } = {},
) {
  const tous = new Map(
    Object.values(parModele)
      .flat()
      .map((r) => [String((r as { itemId: string }).itemId), r]),
  );
  const s = {
    rechercher: vi.fn(async (m: ModeleCible, maxItems: number) => {
      if (m.id === o.rechercheEchoue) throw new Error('acteur indisponible');
      const items = (parModele[m.id] ?? []).slice(0, maxItems);
      return { items, resultatsFactures: items.length };
    }),
    details: vi.fn(async (urls: readonly string[]) => {
      const items = urls
        .map((u) => tous.get(/items\/(\d+)/.exec(u)?.[1] ?? ''))
        .filter((x): x is unknown => x !== undefined);
      return { items, resultatsFactures: items.length, runCoupe: o.detailsCoupe ?? false };
    }),
  } satisfies ScanSource;
  return s;
}

const options = (s: ScanSource, o: Partial<ScanOptions> = {}): ScanOptions => ({
  modeles: MODELES,
  source: s,
  budget: budgetScan(SCAN_PLAFOND_CENTS, 218, 3680),
  depenseDejaMilli: 0,
  maxItemsRecherche: 100,
  maxCandidats: 30,
  seuilMargeCents: 1000,
  topN: 5,
  dejaNotifies: new Set(['106']),
  now: () => new Date('2026-11-05T06:30:00Z'),
  ...o,
});

describe('runScan', () => {
  it('filtre, dédoublonne, détaille en un seul run et classe par marge', async () => {
    const s = source({
      'carhartt-detroit': [A, STYLE, DICKIES, CHERE, CRAWFORD, DEJA, MARCHE],
      'carhartt-crawford': [CRAWFORD],
    });
    const r = await runScan(options(s));

    expect(s.rechercher).toHaveBeenCalledTimes(modelesActifs(MODELES).length);
    expect(s.details).toHaveBeenCalledTimes(1);
    const urls = s.details.mock.calls[0]?.[0] ?? [];
    // Candidats : A, Crawford (une seule fois), Detroit à 45 €. Pas le « style », pas Dickies,
    // pas la Detroit à 70 € (> revente max 57,04 €), pas l'annonce déjà notifiée.
    expect(urls.map((u) => /items\/(\d+)/.exec(u)?.[1]).sort()).toEqual(['101', '105', '107']);

    expect(r.statut).toBe('COMPLETED');
    expect(r.affaires.map((a) => [a.externalId, a.modeleId])).toEqual([
      ['101', 'carhartt-detroit'],
      ['105', 'carhartt-crawford'],
    ]);
    const a = r.affaires[0];
    expect(a?.valeurReventeCents).toBe(4960);
    expect(a?.margeNetteCents).toBeGreaterThanOrEqual(1000);
    expect(a?.photoUrl).toBe('https://example.invalid/photo.webp');
    expect(a?.prixVerifie).toBe(false);
    expect(r.parModele['carhartt-detroit']).toEqual({ resultats: 7, reconnues: 5, candidates: 3 });
    expect(r.categoriesObservees).toEqual({ 'Hommes Vestes': 3 });
    expect(r.depenseRunMilli).toBeGreaterThan(0);
  });

  it('ignore les modèles en réserve : ni recherche, ni reconnaissance', async () => {
    const s = source({
      'carhartt-detroit': [item('401', 'Carhartt Chore Coat Michigan', 10), A],
    });
    const r = await runScan(options(s));
    const recherches = s.rechercher.mock.calls.map((c) => c[0].id);
    expect(recherches).not.toContain('carhartt-chore-coat');
    expect(recherches).not.toContain('tnf-nuptse');
    expect(r.affaires.map((a) => a.externalId)).toEqual(['101']);
  });

  it('limite au top N mais compte toutes les affaires retenues', async () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      item(String(200 + i), 'Carhartt Detroit', 10 + i),
    );
    const r = await runScan(options(source({ 'carhartt-detroit': items }), { topN: 2 }));
    expect(r.affaires.map((a) => a.externalId)).toEqual(['200', '201']);
    expect(r.retenues).toBe(4);
  });

  it('plafonne le nombre de candidats détaillés, les moins chers d’abord', async () => {
    const items = [30, 10, 20].map((p, i) => item(String(300 + i), 'Carhartt Detroit', p));
    const s = source({ 'carhartt-detroit': items });
    const r = await runScan(options(s, { maxCandidats: 2 }));
    expect(s.details.mock.calls[0]?.[0]).toHaveLength(2);
    expect(r.alertes.join()).toMatch(/1 candidat/);
    expect(r.affaires.map((a) => a.externalId)).not.toContain('300');
  });

  it('run de détails coupé : aucune affaire, scan partiel', async () => {
    const r = await runScan(options(source({ 'carhartt-detroit': [A] }, { detailsCoupe: true })));
    expect(r.statut).toBe('PARTIAL');
    expect(r.affaires).toEqual([]);
    expect(r.alertes.join()).toMatch(/coupé/);
  });

  it('une recherche en échec n’empêche pas les autres', async () => {
    const r = await runScan(
      options(
        source(
          { 'carhartt-detroit': [A], 'carhartt-crawford': [CRAWFORD] },
          { rechercheEchoue: 'carhartt-detroit' },
        ),
      ),
    );
    expect(r.statut).toBe('PARTIAL');
    expect(r.affaires.map((a) => a.externalId)).toEqual(['105']);
  });

  it('budget de la campagne épuisé : aucun appel', async () => {
    const s = source({ 'carhartt-detroit': [A] });
    const r = await runScan(options(s, { depenseDejaMilli: 736_000 }));
    expect(r.statut).toBe('BUDGET_STOPPED');
    expect(s.rechercher).not.toHaveBeenCalled();
    expect(s.details).not.toHaveBeenCalled();
  });

  it('ignore une annonce vendue entre la recherche et les détails', async () => {
    const vendue = { ...A, isClosed: true, itemClosingAction: 'sold' };
    const s: ScanSource = {
      rechercher: async () => ({ items: [A], resultatsFactures: 1 }),
      details: async () => ({ items: [vendue], resultatsFactures: 1 }),
    };
    const r = await runScan(options(s));
    expect(r.affaires).toEqual([]);
  });
});

describe('budgetScan', () => {
  it('arrêt dur à 80 % du plafond, une seule enveloppe', () => {
    expect(budgetScan(920, 218, 3680)).toEqual({
      hardStopCents: 736,
      suiviCents: 0,
      decouverteCents: 736,
      coutParResultatMilli: 218,
      coutParRunMilli: 3680,
    });
  });
});

describe('apercuDepuisRecherche', () => {
  it('lit identifiant, titre, marque, prix et complète une URL relative', () => {
    const { url: _u, ...sansUrl } = A;
    void _u;
    expect(apercuDepuisRecherche(sansUrl)).toEqual({
      externalId: '101',
      url: 'https://www.vinted.fr/items/101-annonce',
      titre: 'Veste Carhartt Detroit marron',
      marque: 'Carhartt',
      prixCents: 1500,
    });
  });

  it('rejette un aperçu sans prix ou dans une autre devise', () => {
    expect(apercuDepuisRecherche({ ...A, priceAmount: null })).toBeNull();
    expect(apercuDepuisRecherche({ ...A, currency: 'PLN' })).toBeNull();
  });
});
