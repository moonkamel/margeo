import { z } from 'zod';
import { MULTIPLICATEURS_ETAT_REPLI, DEFAULT_PREFERENCES } from './constants/defaults.js';
import { median } from './estimate.js';
import { computeMargin } from './margin.js';
import { classeColisSchema, type Etat, type MarginResult, type Preferences } from './schemas.js';

/**
 * Modèles ciblés par le scanner (« prix neuf × coefficient d'état »).
 *
 *   valeurRevente = prixNeuf × coefficientModele × MULTIPLICATEURS_ETAT_REPLI[etat]
 *
 * `coefficientModele` est exprimé en TRÈS BON ÉTAT (multiplicateur 1,00). Il part de
 * `coefficientInitial` (estimation prudente, déduite des médianes de revente connues) et se
 * recale sur les ventes réellement observées du modèle :
 *   - < 3 ventes  : coefficient initial seul ;
 *   - 3 à 9 ventes : 0,5 × initial + 0,5 × observé (un prix aberrant ne fait pas tout basculer) ;
 *   - ≥ 10 ventes : coefficient observé seul.
 */

export const VENTES_MIN_MIXTE = 3;
export const VENTES_MIN_OBSERVE = 10;

/** Exclusions communes : annonces qui citent le modèle sans l'être (« style Detroit »). */
export const EXCLUSIONS_COMMUNES: readonly string[] = [
  'style',
  'type',
  'facon',
  'like',
  'inspire',
  'inspired',
  'imitation',
  'replica',
];

const motCleSchema = z
  .string()
  .trim()
  .min(2)
  .transform((s) => normaliserTexte(s));

export const modeleCibleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    marque: z.string().trim().min(1),
    modele: z.string().trim().min(1),
    searchText: z.string().trim().min(2),
    catalogId: z.number().int().positive(),
    /** Chemin attendu, pour contrôle et documentation uniquement (l'identifiant fait foi). */
    catalogPath: z.array(z.string().min(1)).min(1),
    motsClesTitre: z.array(motCleSchema).min(1),
    exclusionsTitre: z.array(motCleSchema),
    classeColis: classeColisSchema,
    prixNeufCents: z.number().int().positive(),
    coefficientInitial: z.number().min(0.05).max(0.9),
    prixVerifie: z.boolean(),
    sourcePrix: z.string().trim().min(5),
  })
  .strict();
export type ModeleCible = z.infer<typeof modeleCibleSchema>;

export const fichierModelesSchema = z
  .object({
    version: z.literal(1),
    notes: z.string().optional(),
    modeles: z.array(modeleCibleSchema).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    const ids = f.modeles.map((m) => m.id);
    const doublon = ids.find((id, i) => ids.indexOf(id) !== i);
    if (doublon) ctx.addIssue({ code: 'custom', message: `Identifiant en double : ${doublon}` });
  });

export function lireModelesCibles(json: unknown): ModeleCible[] {
  return fichierModelesSchema.parse(json).modeles;
}

/** Minuscules, sans accents, ponctuation → espaces, espaces simples, bordé d'espaces. */
export function normaliserTexte(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const contientMot = (texte: string, mot: string) => ` ${texte} `.includes(` ${mot} `);

export interface Reconnaissance {
  modele: ModeleCible;
  /** Mot-clé qui a déclenché la reconnaissance. */
  motCle: string;
}

/**
 * Modèle reconnu dans un titre, ou null. Règles :
 *  - la marque de l'annonce doit être exactement celle du modèle (« Carhartt » ≠ « Carhartt WIP ») ;
 *  - les mots-clés et exclusions sont comparés en MOTS ENTIERS (« streetstyle » n'exclut pas) ;
 *  - un titre contenant une exclusion (commune ou propre au modèle) n'est jamais reconnu ;
 *  - entre plusieurs modèles, le mot-clé le plus long gagne (« og detroit » avant « detroit »,
 *    « crawford » dans « Crawford Detroit »).
 */
export function reconnaitreModele(
  titre: string,
  marque: string | null,
  modeles: readonly ModeleCible[],
): Reconnaissance | null {
  if (!marque) return null;
  const t = normaliserTexte(titre);
  const m = normaliserTexte(marque);
  let meilleur: Reconnaissance | null = null;
  for (const modele of modeles) {
    if (normaliserTexte(modele.marque) !== m) continue;
    const exclusions = [...EXCLUSIONS_COMMUNES, ...modele.exclusionsTitre];
    if (exclusions.some((e) => contientMot(t, e))) continue;
    for (const motCle of modele.motsClesTitre) {
      if (contientMot(t, motCle) && (!meilleur || motCle.length > meilleur.motCle.length)) {
        meilleur = { modele, motCle };
      }
    }
  }
  return meilleur;
}

export interface VenteModele {
  prixVenteCents: number;
  etat: Etat;
}

export type SourceCoefficient = 'initial' | 'mixte' | 'observe';

export interface EstimationNeuf {
  valeurReventeCents: number;
  /** Coefficient en très bon état effectivement utilisé. */
  coefficient: number;
  source: SourceCoefficient;
  nbVentes: number;
}

/** Coefficient du modèle (très bon état), recalé sur les ventes observées. */
export function coefficientModele(
  modele: ModeleCible,
  ventes: readonly VenteModele[],
): { coefficient: number; source: SourceCoefficient } {
  if (ventes.length < VENTES_MIN_MIXTE) {
    return { coefficient: modele.coefficientInitial, source: 'initial' };
  }
  // Chaque vente est ramenée à son équivalent « très bon état » avant la médiane.
  const equivalents = ventes.map((v) => v.prixVenteCents / MULTIPLICATEURS_ETAT_REPLI[v.etat]);
  const observe = median(equivalents) / modele.prixNeufCents;
  if (ventes.length < VENTES_MIN_OBSERVE) {
    return { coefficient: 0.5 * modele.coefficientInitial + 0.5 * observe, source: 'mixte' };
  }
  return { coefficient: observe, source: 'observe' };
}

export function estimerDepuisPrixNeuf(
  modele: ModeleCible,
  etat: Etat,
  ventes: readonly VenteModele[] = [],
): EstimationNeuf {
  const { coefficient, source } = coefficientModele(modele, ventes);
  return {
    valeurReventeCents: Math.round(
      modele.prixNeufCents * coefficient * MULTIPLICATEURS_ETAT_REPLI[etat],
    ),
    coefficient,
    source,
    nbVentes: ventes.length,
  };
}

/**
 * Prix d'achat au-delà duquel aucune marge n'est possible, quel que soit l'état : valeur de
 * revente dans le meilleur état. Sert au filtre grossier AVANT l'appel de détails (l'état n'est
 * pas encore connu à ce stade).
 */
export function prixMaxAchatCents(
  modele: ModeleCible,
  ventes: readonly VenteModele[] = [],
): number {
  const etatMax = (Object.keys(MULTIPLICATEURS_ETAT_REPLI) as Etat[]).reduce((a, b) =>
    MULTIPLICATEURS_ETAT_REPLI[a] >= MULTIPLICATEURS_ETAT_REPLI[b] ? a : b,
  );
  return estimerDepuisPrixNeuf(modele, etatMax, ventes).valeurReventeCents;
}

export interface AnalyseModele {
  estimation: EstimationNeuf;
  margin: MarginResult;
}

/** Marge complète d'une annonce d'un modèle ciblé (frais, port, cotisations, temps). */
export function analyserAnnonceModele(
  modele: ModeleCible,
  annonce: { prixCents: number; etat: Etat },
  ventes: readonly VenteModele[] = [],
  preferences: Preferences = DEFAULT_PREFERENCES,
): AnalyseModele {
  const estimation = estimerDepuisPrixNeuf(modele, annonce.etat, ventes);
  const margin = computeMargin({
    prixAchatCents: annonce.prixCents,
    prixReventeEstimeCents: estimation.valeurReventeCents,
    classeColis: modele.classeColis,
    preferences,
    // Délai de vente inconnu pour un modèle : confiance « low », vitesse neutre.
    medianJoursVente: null,
  });
  return { estimation, margin };
}
