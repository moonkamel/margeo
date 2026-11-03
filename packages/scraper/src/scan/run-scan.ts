/**
 * Scanner de bonnes affaires (V1, modèles ciblés). Logique PURE : la source (Apify) et le budget
 * sont injectés ; aucune base, aucune notification ici.
 *
 * Déroulé d'un scan :
 *  1. une recherche par modèle (texte du modèle + catalogue, plus récentes d'abord, SANS détails) ;
 *  2. filtre grossier sur l'aperçu : marque exacte, modèle reconnu dans le titre (exclusions
 *     « style », « type »…), prix ≤ revente maximale du modèle, annonce jamais notifiée ;
 *     dédoublonnage entre recherches ;
 *  3. UN SEUL run de détails pour tous les candidats (état, taille, photos) ;
 *  4. marge complète (prix neuf × coefficient du modèle × état), seuil, top N.
 *
 * Budget : campagne dédiée (`scan-YYYY-MM`), arrêt dur. Run de détails coupé (timeout) : aucune
 * affaire n'est retenue pour ce scan (données partielles), une alerte est levée.
 */
import {
  analyserAnnonceModele,
  DEFAULT_PREFERENCES,
  prixMaxAchatCents,
  reconnaitreModele,
  type Etat,
  type ModeleCible,
  type Preferences,
  type SourceCoefficient,
  type VenteModele,
} from '@margeo/shared';
import { adaptActorItem } from '../adapters/abotapi.js';
import { normalizeVintedItem, parsePriceToCents } from '../normalize.js';
import {
  BudgetLedger,
  formatMilli,
  plafondRunUsd,
  type BudgetConfig,
  type Reservation,
} from '../seed/budget.js';
import type { Facturation, PlafondAppel } from '../seed/types.js';

export interface ScanSource {
  /** Recherche d'un modèle, sans détails (aperçu : titre, marque, prix, URL). */
  rechercher(
    modele: ModeleCible,
    maxItems: number,
    plafond: PlafondAppel,
  ): Promise<{ items: unknown[] } & Facturation>;
  /** Détails d'annonces (état, taille, photos), en un seul run. */
  details(
    urls: readonly string[],
    plafond: PlafondAppel,
  ): Promise<{ items: unknown[] } & Facturation>;
}

export interface Apercu {
  externalId: string;
  url: string;
  titre: string;
  marque: string | null;
  prixCents: number;
}

export interface Affaire {
  externalId: string;
  url: string;
  titre: string;
  modeleId: string;
  modele: string;
  marque: string;
  etat: Etat;
  taille: string | null;
  prixCents: number;
  valeurReventeCents: number;
  margeNetteCents: number;
  score: number;
  sourceCoefficient: SourceCoefficient;
  prixVerifie: boolean;
  nbVentesModele: number;
  photoUrl: string | null;
  /** Sous-catégorie déclarée par l'annonce (contrôle de `catalogPath`). */
  categorie: string | null;
}

export interface StatsModele {
  resultats: number;
  reconnues: number;
  candidates: number;
}

export type ScanStatut = 'COMPLETED' | 'PARTIAL' | 'BUDGET_STOPPED';

export interface ScanResult {
  statut: ScanStatut;
  /** Top N, triées par marge nette décroissante. */
  affaires: Affaire[];
  /** Affaires au-dessus du seuil, avant le top N. */
  retenues: number;
  annoncesVues: number;
  candidates: number;
  parModele: Record<string, StatsModele>;
  /** Sous-catégories observées sur les détails (libellé → nombre), pour contrôler `catalogPath`. */
  categoriesObservees: Record<string, number>;
  depenseRunMilli: number;
  depenseCampagneMilli: number;
  alertes: string[];
}

export interface ScanOptions {
  modeles: readonly ModeleCible[];
  source: ScanSource;
  budget: BudgetConfig;
  /** Déjà dépensé sur la campagne de scan du mois, en milli. */
  depenseDejaMilli: number;
  maxItemsRecherche: number;
  /** Plafond de candidats envoyés au run de détails (les moins chers relativement d'abord). */
  maxCandidats: number;
  /** Marge nette minimale pour retenir une affaire, en centimes. */
  seuilMargeCents: number;
  topN: number;
  /** Annonces déjà notifiées : jamais renvoyées. */
  dejaNotifies: ReadonlySet<string>;
  /** Ventes observées par modèle (recalage du coefficient). */
  ventesParModele?: ReadonlyMap<string, readonly VenteModele[]>;
  preferences?: Preferences;
  now?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const texte = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null;

/** Aperçu d'un résultat de recherche (sans détails : pas d'état, la normalisation est impossible). */
export function apercuDepuisRecherche(raw: unknown): Apercu | null {
  const a = adaptActorItem(raw);
  if (!isRecord(a)) return null;
  const externalId = texte(a['id']);
  const titre = texte(a['title']);
  const prix = isRecord(a['price']) ? a['price'] : null;
  const prixCents = parsePriceToCents(prix ? prix['amount'] : a['price']);
  const devise = prix ? texte(prix['currency_code']) : null;
  const brut = texte(a['url']);
  if (!externalId || !titre || prixCents === null || (devise && devise !== 'EUR')) return null;
  const url = brut?.startsWith('/') ? `https://www.vinted.fr${brut}` : brut;
  if (!url) return null;
  return { externalId, url, titre, marque: texte(a['brand_title']), prixCents };
}

/** Coût enregistré d'un appel : coût réel s'il est connu, jamais moins que l'estimation. */
function coutAppel(ledger: BudgetLedger, r: Reservation, f: Facturation): number {
  const estime = ledger.costFor(f.resultatsFactures);
  return f.runCoupe ? Math.max(r.maxMilli, estime) : Math.max(estime, f.coutReelMilli ?? 0);
}

export async function runScan(o: ScanOptions): Promise<ScanResult> {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? (() => {});
  const preferences = o.preferences ?? DEFAULT_PREFERENCES;
  const ventes = (m: ModeleCible) => o.ventesParModele?.get(m.id) ?? [];
  const ledger = new BudgetLedger(o.budget, { suivi: 0, decouverte: o.depenseDejaMilli });
  const debut = ledger.totalMilli;
  const alertes: string[] = [];
  const parModele: Record<string, StatsModele> = {};
  let partiel = false;
  let budgetStop = false;
  let annoncesVues = 0;

  // ── 1-2. Recherches + filtre grossier ───────────────────────────────────────────────────
  const candidats = new Map<string, { apercu: Apercu; modele: ModeleCible; plafond: number }>();
  for (const modele of o.modeles) {
    const stats: StatsModele = { resultats: 0, reconnues: 0, candidates: 0 };
    parModele[modele.id] = stats;
    const r = ledger.reserve('decouverte', o.maxItemsRecherche);
    if (typeof r === 'string') {
      budgetStop = true;
      alertes.push(`ARRÊT DUR : budget de scan atteint avant la recherche « ${modele.modele} ».`);
      break;
    }
    let reponse;
    try {
      reponse = await o.source.rechercher(modele, o.maxItemsRecherche, {
        maxTotalChargeUsd: plafondRunUsd(r.maxMilli),
      });
    } catch (err) {
      ledger.commitMilli(r, r.maxMilli); // prudence : coût maximal compté
      partiel = true;
      alertes.push(`Recherche « ${modele.modele} » en échec : ${String(err)}`);
      continue;
    }
    ledger.commitMilli(r, coutAppel(ledger, r, reponse));
    if (reponse.runCoupe) {
      partiel = true;
      alertes.push(`Recherche « ${modele.modele} » coupée : résultats partiels.`);
    }
    stats.resultats = reponse.items.length;
    annoncesVues += reponse.items.length;
    for (const raw of reponse.items) {
      const ap = apercuDepuisRecherche(raw);
      if (!ap) continue;
      // Reconnaissance sur TOUS les modèles : une Crawford trouvée par la recherche « Detroit »
      // est rattachée à la Crawford.
      const rec = reconnaitreModele(ap.titre, ap.marque, o.modeles);
      if (!rec) continue;
      stats.reconnues++;
      if (o.dejaNotifies.has(ap.externalId) || candidats.has(ap.externalId)) continue;
      const plafond = prixMaxAchatCents(rec.modele, ventes(rec.modele));
      if (ap.prixCents >= plafond) continue;
      candidats.set(ap.externalId, { apercu: ap, modele: rec.modele, plafond });
      stats.candidates++;
    }
    log('scan.recherche', { modele: modele.id, ...stats });
  }

  // Les moins chers relativement à leur plafond d'abord, dans la limite de maxCandidats.
  const retenus = [...candidats.values()]
    .sort((a, b) => a.apercu.prixCents / a.plafond - b.apercu.prixCents / b.plafond)
    .slice(0, o.maxCandidats);
  if (candidats.size > retenus.length) {
    alertes.push(
      `${candidats.size - retenus.length} candidat(s) non détaillé(s) (plafond ${o.maxCandidats}).`,
    );
  }

  // ── 3. Un seul run de détails ───────────────────────────────────────────────────────────
  const affaires: Affaire[] = [];
  const categoriesObservees: Record<string, number> = {};
  if (retenus.length > 0 && !budgetStop) {
    const r = ledger.reserve('decouverte', retenus.length);
    if (typeof r === 'string') {
      budgetStop = true;
      alertes.push('ARRÊT DUR : budget de scan atteint avant le run de détails.');
    } else {
      let reponse: ({ items: unknown[] } & Facturation) | null = null;
      try {
        reponse = await o.source.details(
          retenus.map((c) => c.apercu.url),
          { maxTotalChargeUsd: plafondRunUsd(r.maxMilli) },
        );
        ledger.commitMilli(r, coutAppel(ledger, r, reponse));
      } catch (err) {
        ledger.commitMilli(r, r.maxMilli);
        partiel = true;
        alertes.push(`Run de détails en échec : ${String(err)} — aucune affaire retenue.`);
      }
      if (reponse?.runCoupe) {
        partiel = true;
        alertes.push('Run de détails coupé : données partielles, aucune affaire retenue.');
      } else if (reponse) {
        // ── 4. Marge complète ─────────────────────────────────────────────────────────────
        for (const raw of reponse.items) {
          const n = normalizeVintedItem(raw, now());
          if (!n.ok || n.listing.statut !== 'active') continue;
          const l = n.listing;
          const cat = adaptActorItem(raw);
          const categorie = isRecord(cat) ? texte(cat['catalog_title']) : null;
          if (categorie) categoriesObservees[categorie] = (categoriesObservees[categorie] ?? 0) + 1;
          // Revérification sur les données détaillées (titre et marque font foi).
          const rec = reconnaitreModele(l.titre, l.marque, o.modeles);
          if (!rec || o.dejaNotifies.has(l.externalId)) continue;
          const v = ventes(rec.modele);
          const { estimation, margin } = analyserAnnonceModele(
            rec.modele,
            { prixCents: l.prixCents, etat: l.etat },
            v,
            preferences,
          );
          if (margin.margeNetteCents < o.seuilMargeCents) continue;
          affaires.push({
            externalId: l.externalId,
            url: l.url,
            titre: l.titre,
            modeleId: rec.modele.id,
            modele: rec.modele.modele,
            marque: rec.modele.marque,
            etat: l.etat,
            taille: l.taille,
            prixCents: l.prixCents,
            valeurReventeCents: estimation.valeurReventeCents,
            margeNetteCents: margin.margeNetteCents,
            score: margin.score,
            sourceCoefficient: estimation.source,
            prixVerifie: rec.modele.prixVerifie,
            nbVentesModele: estimation.nbVentes,
            photoUrl: l.photos[0] ?? null,
            categorie,
          });
        }
      }
    }
  }

  affaires.sort((a, b) => b.margeNetteCents - a.margeNetteCents || b.score - a.score);
  const depenseRunMilli = ledger.totalMilli - debut;
  const statut: ScanStatut = budgetStop ? 'BUDGET_STOPPED' : partiel ? 'PARTIAL' : 'COMPLETED';
  log('scan.fin', {
    statut,
    annoncesVues,
    candidates: retenus.length,
    retenues: affaires.length,
    depenseRun: formatMilli(depenseRunMilli),
  });
  return {
    statut,
    affaires: affaires.slice(0, o.topN),
    retenues: affaires.length,
    annoncesVues,
    candidates: retenus.length,
    parModele,
    categoriesObservees,
    depenseRunMilli,
    depenseCampagneMilli: ledger.totalMilli,
    alertes,
  };
}
