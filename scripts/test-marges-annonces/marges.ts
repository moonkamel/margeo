/**
 * Test GRATUIT : marge des annonces suivies, calculée par `analyzeListing` sur un export JSON
 * de la base (export.sql). Aucun accès réseau ni base : le script ne lit qu'un fichier.
 * Sans ventes suffisantes, le résultat est `insufficient_data` : aucune médiane n'est inventée.
 *
 *   packages/scraper/node_modules/.bin/tsx scripts/test-marges-annonces/marges.ts <export.json>
 */
import { readFileSync } from 'node:fs';
import {
  analyzeListing,
  DEFAULT_PREFERENCES,
  etatSchema,
  formatEuros,
  soldSaleSchema,
  type AnalysisResult,
  type SoldSale,
} from '../../packages/shared/src/index.js';

type Etat = ReturnType<typeof etatSchema.parse>;
interface Annonce {
  externalId: string;
  url: string;
  titre: string | null;
  categorie: string;
  marque: string | null;
  taille: string | null;
  etat: Etat;
  prixCents: number;
}
export interface Export {
  extraitLe?: string;
  annonces: Annonce[];
  ventes: SoldSale[];
}

/** Validation de l'export (sans dépendance directe à zod : schémas de @margeo/shared). */
export function lireExport(json: unknown): Export {
  const o = json as { extraitLe?: unknown; annonces?: unknown; ventes?: unknown };
  const annonces = (Array.isArray(o.annonces) ? o.annonces : []).map((a: Record<string, unknown>) => {
    if (typeof a['externalId'] !== 'string' || typeof a['categorie'] !== 'string' || !Number.isInteger(a['prixCents']))
      throw new Error(`Annonce invalide : ${JSON.stringify(a).slice(0, 120)}`);
    const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : null);
    return {
      externalId: a['externalId'],
      url: str('url') ?? '',
      titre: str('titre'),
      categorie: a['categorie'],
      marque: str('marque'),
      taille: str('taille'),
      etat: etatSchema.parse(a['etat']),
      prixCents: a['prixCents'] as number,
    };
  });
  const ventes = soldSaleSchema.array().parse(o.ventes ?? []);
  return { ...(typeof o.extraitLe === 'string' ? { extraitLe: o.extraitLe } : {}), annonces, ventes };
}

export interface Ligne {
  annonce: Annonce;
  cellule: string;
  resultat: AnalysisResult;
  anomalies: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const sansAccents = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function calculer(e: Export, now: Date): Ligne[] {
  const cellule = (a: Annonce) => `${a.categorie}|${a.marque ?? '?'}`;
  const prixParCellule = new Map<string, number[]>();
  for (const a of e.annonces)
    prixParCellule.set(cellule(a), [...(prixParCellule.get(cellule(a)) ?? []), a.prixCents]);
  return e.annonces.map((a) => {
    const resultat = analyzeListing({
      listing: a,
      ventes: e.ventes,
      preferences: DEFAULT_PREFERENCES,
      now,
    });
    const med = median(prixParCellule.get(cellule(a)) ?? []);
    const anomalies: string[] = [];
    if (a.prixCents < 500) anomalies.push('prix < 5 €');
    if (med > 0 && a.prixCents > 3 * med) anomalies.push('prix > 3 × médiane affichée');
    if (med > 0 && a.prixCents * 3 < med) anomalies.push('prix < ⅓ médiane affichée');
    if (a.marque && a.titre && !sansAccents(a.titre).includes(sansAccents(a.marque)))
      anomalies.push('marque absente du titre');
    return { annonce: a, cellule: cellule(a), resultat, anomalies };
  });
}

const col = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const colD = (s: string, n: number) => s.padStart(n);

export function formater(lignes: Ligne[], e: Export): string {
  const l: string[] = [];
  l.push(
    `${col('Cellule', 22)} | ${col('Titre', 30)} | ${colD('Prix', 9)} | ${colD('Marge', 9)} | ${col('Statut', 12)} | ${col('Niveau', 22)} | Ventes`,
  );
  l.push('-'.repeat(130));
  for (const { annonce: a, cellule, resultat: r, anomalies } of lignes) {
    const ok = r.status === 'ok';
    l.push(
      [
        col(cellule.replace('Sweats et sweats à capuche', 'Sweats'), 22),
        col(a.titre ?? '(sans titre)', 30),
        colD(formatEuros(a.prixCents), 9),
        colD(ok ? formatEuros(r.margin.margeNetteCents) : '—', 9),
        col(ok ? r.margin.statut : 'insuffisant', 12),
        col(ok ? r.estimate.niveau : '—', 22),
        String(ok ? r.estimate.nbVentes : r.nbVentesTrouvees) +
          (anomalies.length ? `  ⚠ ${anomalies.join(', ')}` : ''),
      ].join(' | '),
    );
  }
  l.push('');
  l.push('Statistiques par cellule (prix AFFICHÉS des annonces suivies, pas des ventes) :');
  const cellules = [...new Set(lignes.map((x) => x.cellule))];
  for (const c of cellules) {
    const p = lignes.filter((x) => x.cellule === c).map((x) => x.annonce.prixCents);
    l.push(
      `  ${col(c, 44)} ${String(p.length).padStart(3)} annonces · min ${formatEuros(Math.min(...p))} · médiane ${formatEuros(median(p))} · max ${formatEuros(Math.max(...p))}`,
    );
  }
  const insuff = lignes.filter((x) => x.resultat.status === 'insufficient_data').length;
  const prix = e.ventes.filter((v) => v.source === 'sold_status').length;
  l.push('');
  l.push(`Annonces : ${lignes.length} · insufficient_data : ${insuff}/${lignes.length}`);
  l.push(
    `Ventes en base : ${e.ventes.length} (dont ${prix} « sold » explicites, seules utilisées pour la médiane)`,
  );
  l.push(
    `Annonces avec au moins 1 vente observée dans leur cellule : ${lignes.filter((x) => (x.resultat.status === 'ok' ? x.resultat.estimate.nbVentes : x.resultat.nbVentesTrouvees) > 0).length}`,
  );
  l.push(`Anomalies potentielles : ${lignes.filter((x) => x.anomalies.length > 0).length}`);
  return l.join('\n');
}

const fichier = process.argv[2];
if (fichier && import.meta.url === `file://${process.argv[1]}`) {
  const e = lireExport(JSON.parse(readFileSync(fichier, 'utf8')));
  console.log(formater(calculer(e, e.extraitLe ? new Date(e.extraitLe) : new Date()), e));
}
