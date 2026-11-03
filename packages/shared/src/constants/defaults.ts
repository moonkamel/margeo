import type { Etat } from '../schemas.js';

/**
 * Taux de cotisations sociales micro-entrepreneur, régime micro-BIC,
 * activité de vente de marchandises : 12,3 % du chiffre d'affaires encaissé.
 */
export const COTISATIONS_MICRO_BIC_VENTE = 0.123;

/**
 * Préférences par défaut d'un nouvel utilisateur.
 * Le taux horaire par défaut (12 €/h) est volontairement proche du SMIC horaire brut :
 * c'est un point de départ neutre, signalé comme « non modifié » tant que
 * l'utilisateur ne l'a pas changé (`tauxHoraireModifieManuellement`).
 */
export const DEFAULT_PREFERENCES = {
  tauxHoraireCents: 1200,
  seuilMargeCents: 500,
  tempsEstimeMinutes: 20,
  coutEmballageCents: 50,
  modeVente: 'PARTICULIER',
} as const;

/** Paramètres de la médiane mobile des ventes réelles. */
export const ESTIMATION = {
  /** Fenêtre glissante, en jours. */
  fenetreJours: 30,
  /** Nombre minimal de ventes dans une cellule pour qu'elle soit exploitable. */
  minVentes: 5,
} as const;

/**
 * Multiplicateurs d'état de REPLI, relatifs à « très bon état » (= 1,00).
 * Utilisés uniquement quand la cellule ne contient pas assez de ventes pour l'état visé ;
 * le résultat est alors marqué `source: 'fallback'`.
 */
export const MULTIPLICATEURS_ETAT_REPLI: Readonly<Record<Etat, number>> = {
  NEUF_AVEC_ETIQUETTE: 1.15,
  NEUF_SANS_ETIQUETTE: 1.05,
  TRES_BON: 1.0,
  BON: 0.85,
  SATISFAISANT: 0.7,
};

/** Paramètres du score « bonne affaire » (0–100). */
export const SCORE = {
  poidsMarge: 0.7,
  poidsVitesse: 0.3,
  /** Vitesse = 1 si la médiane du délai de vente est inférieure ou égale à ce seuil. */
  joursVenteRapide: 3,
  /** Vitesse = 0 si la médiane du délai de vente est supérieure ou égale à ce seuil. */
  joursVenteLente: 30,
  /** Valeur neutre quand aucune donnée de délai n'est disponible (confiance faible). */
  vitesseParDefaut: 0.5,
} as const;
