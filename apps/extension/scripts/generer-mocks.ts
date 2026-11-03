/**
 * Génère src/lib/mocks.json avec analyzeListing LUI-MÊME : les maquettes sont conformes au contrat
 * par construction (validées par analysisResultSchema), le branchement sur l'API ne demandera
 * aucune adaptation.  Lancer : pnpm --filter @margeo/extension mocks (ou tsx directement).
 */
import { writeFileSync } from 'node:fs';
import {
  analysisResultSchema,
  analyzeListing,
  analyzeRequestSchema,
  DEFAULT_PREFERENCES,
  type AnalyzeRequest,
  type Etat,
  type SoldSale,
} from '../../../packages/shared/src/index.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const JOUR = 86_400_000;

/** n ventes « très bon état » autour d'un prix ; délai de vente connu si `delai` est fourni. */
function ventes(
  c: string,
  m: string,
  t: string | null,
  prix: number[],
  delai?: number,
): SoldSale[] {
  return prix.map((p, i) => {
    const soldAt = new Date(NOW.getTime() - (i + 1) * JOUR);
    return {
      prixVenteCents: p,
      etat: 'TRES_BON' as Etat,
      categorie: c,
      marque: m,
      taille: t,
      soldAt,
      listedAt: delai === undefined ? null : new Date(soldAt.getTime() - delai * JOUR),
      source: 'sold_status' as const,
    };
  });
}

function annonce(
  id: string,
  titre: string,
  prixCents: number,
  marque: string,
  categorie: string,
  taille: string | null,
): AnalyzeRequest {
  return analyzeRequestSchema.parse({
    externalId: id,
    url: `https://www.vinted.fr/items/${id}-annonce`,
    titre,
    prixCents,
    marque,
    taille,
    etat: 'Très bon état',
    categorie,
  });
}

function cas(cle: string, libelle: string, a: AnalyzeRequest, categorie: string, v: SoldSale[]) {
  const resultat = analysisResultSchema.parse(
    analyzeListing({
      listing: {
        prixCents: a.prixCents,
        categorie,
        marque: a.marque,
        taille: a.taille,
        etat: 'TRES_BON',
      },
      ventes: v,
      preferences: { ...DEFAULT_PREFERENCES },
      now: NOW,
    }),
  );
  return { cle, libelle, annonce: a, resultat, erreur: null };
}

const B = 'Baskets (H)';
const S = 'Sweats et sweats à capuche (F)';
const maquettes = [
  cas(
    'vert',
    'Bonne affaire (VERT, confiance élevée)',
    annonce('100000', 'Nike Air Force 1 blanches', 2500, 'Nike', B, '42'),
    B,
    ventes(B, 'Nike', '42', [6500, 7000, 7200, 6800, 7500, 6900], 6),
  ),
  cas(
    'orange',
    'Marge faible (ORANGE)',
    annonce('100001', 'Adidas Samba OG', 4800, 'Adidas', B, '41'),
    B,
    ventes(B, 'Adidas', '41', [7000, 7200, 6900, 7100, 7300], 9),
  ),
  cas(
    'rouge',
    'À éviter (ROUGE)',
    annonce('100002', 'Pull Sézane col V', 6000, 'Sézane', S, null),
    S,
    ventes(S, 'Sézane', null, [5500, 5800, 6000, 5700, 5900], 12),
  ),
  cas(
    'insuffisant',
    'Données insuffisantes',
    annonce(
      '100003',
      'Ralph Lauren pull torsadé',
      2000,
      'Ralph Lauren',
      'Sweats et pulls (H)',
      'L',
    ),
    'Sweats et pulls (H)',
    ventes('Sweats et pulls (H)', 'Ralph Lauren', 'L', [4000, 4200]),
  ),
  cas(
    'confiance-basse',
    'Confiance basse (vitesse de vente inconnue)',
    annonce('100004', 'Nike Dunk Low', 3000, 'Nike', B, '43'),
    B,
    ventes(B, 'Nike', null, [7000, 7400, 6800, 7200, 7100]),
  ),
  {
    cle: 'erreur-reseau',
    libelle: 'Erreur réseau (API injoignable)',
    annonce: annonce('100005', 'Adidas Gazelle', 3500, 'Adidas', B, '40'),
    resultat: null,
    erreur: 'reseau',
  },
];

const chemin = new URL('../src/lib/mocks.json', import.meta.url);
writeFileSync(chemin, `${JSON.stringify(maquettes, null, 2)}\n`);
for (const m of maquettes) {
  const r = m.resultat;
  console.log(
    `${m.cle.padEnd(16)} ${r?.status === 'ok' ? `${r.margin.statut} ${(r.margin.margeNetteCents / 100).toFixed(2)} € (${r.margin.confidence}, ${r.estimate.niveau})` : r ? r.status : 'erreur réseau'}`,
  );
}
