import { z } from 'zod';

/** Montant en centimes, positif ou nul (prix, frais, préférences). */
export const centsSchema = z.number().int().nonnegative();
/** Montant en centimes signé (résultats : une marge peut être négative). */
export const signedCentsSchema = z.number().int();

export const modeVenteSchema = z.enum(['PARTICULIER', 'PRO']);
export type ModeVente = z.infer<typeof modeVenteSchema>;

/** Les 5 états proposés par Vinted. */
export const etatSchema = z.enum([
  'NEUF_AVEC_ETIQUETTE',
  'NEUF_SANS_ETIQUETTE',
  'TRES_BON',
  'BON',
  'SATISFAISANT',
]);
export type Etat = z.infer<typeof etatSchema>;

export const classeColisSchema = z.enum(['PETIT', 'MOYEN', 'GRAND']);
export type ClasseColis = z.infer<typeof classeColisSchema>;

/** VERT = « Acheter », ORANGE = « Négocier », ROUGE = « Passer ». */
export const statutSchema = z.enum(['VERT', 'ORANGE', 'ROUGE']);
export type Statut = z.infer<typeof statutSchema>;

export const confidenceSchema = z.enum(['low', 'high']);
export type Confidence = z.infer<typeof confidenceSchema>;

export const priceSourceSchema = z.enum(['empirical', 'fallback']);
export type PriceSource = z.infer<typeof priceSourceSchema>;

export const niveauEstimationSchema = z.enum([
  'categorie_marque_taille',
  'categorie_marque',
  'categorie',
]);
export type NiveauEstimation = z.infer<typeof niveauEstimationSchema>;

export const planSchema = z.enum(['FREE', 'MONTHLY', 'ANNUAL']);
export type Plan = z.infer<typeof planSchema>;

/** Préférences utilisateur utilisées par le moteur de marge. */
export const preferencesSchema = z.object({
  tauxHoraireCents: centsSchema,
  seuilMargeCents: centsSchema,
  tempsEstimeMinutes: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60),
  coutEmballageCents: centsSchema,
  modeVente: modeVenteSchema,
});
export type Preferences = z.infer<typeof preferencesSchema>;

/**
 * Vente observée. Seules les ventes `sold_status` alimentent la médiane de prix ;
 * les disparitions (`disappeared`) ne servent qu'au calcul de la vitesse de vente.
 * `prixVenteCents` est le dernier prix affiché avant la vente (pas le prix négocié).
 */
export const soldSaleSchema = z.object({
  prixVenteCents: centsSchema,
  etat: etatSchema,
  categorie: z.string().min(1),
  marque: z.string().min(1).nullable(),
  taille: z.string().min(1).nullable(),
  soldAt: z.coerce.date(),
  /** Date de première observation / publication, si connue (pour le délai de vente). */
  listedAt: z.coerce.date().nullable(),
  source: z.enum(['sold_status', 'disappeared']),
});
export type SoldSale = z.infer<typeof soldSaleSchema>;

/** Annonce Vinted normalisée, quel que soit le driver de scraping. */
export const normalizedListingSchema = z.object({
  plateforme: z.literal('VINTED'),
  externalId: z.string().min(1),
  url: z.url(),
  titre: z.string(),
  marque: z.string().min(1).nullable(),
  categorie: z.string().min(1),
  taille: z.string().min(1).nullable(),
  etat: etatSchema,
  prixCents: centsSchema,
  favoris: z.number().int().nonnegative(),
  vues: z.number().int().nonnegative(),
  photos: z.array(z.url()),
  description: z.string(),
  vendeur: z.object({
    pseudo: z.string(),
    ancienneteJours: z.number().int().nonnegative().nullable(),
    note: z.number().min(0).max(5).nullable(),
    nbEvaluations: z.number().int().nonnegative().nullable(),
  }),
  statut: z.enum(['active', 'sold']),
});
export type NormalizedListing = z.infer<typeof normalizedListingSchema>;

/** Statistiques de prix de ventes réelles, renvoyées par `ScraperDriver.searchSoldPrices`. */
export const priceStatsSchema = z.object({
  categorie: z.string().min(1),
  marque: z.string().min(1).nullable(),
  taille: z.string().min(1).nullable(),
  ventes: z.array(soldSaleSchema),
  nbVentes: z.number().int().nonnegative(),
  medianeCents: centsSchema.nullable(),
  minCents: centsSchema.nullable(),
  maxCents: centsSchema.nullable(),
  collecteAt: z.coerce.date(),
});
export type PriceStats = z.infer<typeof priceStatsSchema>;

/** Estimation du prix de revente, toujours traçable aux ventes utilisées. */
export const priceEstimateSchema = z.object({
  prixReventeEstimeCents: centsSchema,
  /** Médiane brute de la cellule, avant ajustement d'état. */
  medianeCents: centsSchema,
  nbVentes: z.number().int().positive(),
  niveau: niveauEstimationSchema,
  source: priceSourceSchema,
  /** Multiplicateur d'état appliqué (1 si médiane empirique de l'état). */
  multiplicateurEtat: z.number().positive(),
  fenetreJours: z.number().int().positive(),
  minCents: centsSchema,
  maxCents: centsSchema,
  /** Médiane du délai de vente en jours, null si données insuffisantes. */
  medianJoursVente: z.number().nonnegative().nullable(),
});
export type PriceEstimate = z.infer<typeof priceEstimateSchema>;

export const marginLineKeySchema = z.enum([
  'prix_revente',
  'prix_achat',
  'frais_vinted',
  'frais_port',
  'emballage',
  'cotisations',
  'temps',
]);
export type MarginLineKey = z.infer<typeof marginLineKeySchema>;

/** Ligne du détail de calcul. `montantCents` est signé : négatif = coût. */
export const marginLineSchema = z.object({
  cle: marginLineKeySchema,
  libelle: z.string(),
  montantCents: signedCentsSchema,
  detail: z.string().optional(),
  /** Préférences modifiables inline depuis cette ligne (recalcul client). */
  editable: z
    .array(z.enum(['tauxHoraireCents', 'tempsEstimeMinutes', 'coutEmballageCents']))
    .optional(),
});
export type MarginLine = z.infer<typeof marginLineSchema>;

export const marginResultSchema = z.strictObject({
  margeNetteCents: signedCentsSchema,
  statut: statutSchema,
  score: z.number().int().min(0).max(100),
  confidence: confidenceSchema,
  vitesse: z.number().min(0).max(1),
  lignes: z.array(marginLineSchema),
  preferences: preferencesSchema,
});
export type MarginResult = z.infer<typeof marginResultSchema>;

/**
 * Requête `POST /analyze` (décision du 2026-11-03) : l'extension lit l'annonce SUR LA PAGE et
 * n'envoie que ces champs — ni description, ni vendeur, ni photo (minimisation par construction).
 * Les textes sont ceux affichés par Vinted ; l'API les rapproche (alias de marque, état…).
 */
export const analyzeRequestSchema = z.strictObject({
  externalId: z.string().regex(/^\d+$/),
  url: z.url(),
  titre: z.string().trim().min(1).max(300),
  prixCents: z.number().int().positive(),
  marque: z.string().trim().min(1).max(100),
  taille: z.string().trim().min(1).max(50).nullable(),
  etat: z.string().trim().min(1).max(50).nullable(),
  categorie: z.string().trim().min(1).max(200).nullable(),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/** Résultat d'une analyse : servie (`ok`) ou non estimable (`insufficient_data`). */
export const analysisResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    estimate: priceEstimateSchema,
    margin: marginResultSchema,
  }),
  z.object({
    status: z.literal('insufficient_data'),
    message: z.string(),
    /** Nombre de ventes trouvées au niveau le plus large, pour transparence. */
    nbVentesTrouvees: z.number().int().nonnegative(),
    minVentesRequis: z.number().int().positive(),
  }),
]);
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
