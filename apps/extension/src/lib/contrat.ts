/**
 * Contrat partagé avec l'API (types uniquement, effacés au build : aucun code de
 * packages/shared n'est embarqué dans l'extension).
 */
export type {
  AnalysisResult,
  AnalyzeRequest,
  MarginLine,
} from '../../../../packages/shared/src/index.js';

/** Message du script de contenu au service worker. */
export type MessageContenu =
  { type: 'margeo:ouvrir'; lecture: Lecture } | { type: 'margeo:annonce'; lecture: Lecture };

/** Résultat de la lecture de la page : annonce exploitable, ou échec explicite (règle A). */
export type Lecture =
  | { ok: true; annonce: import('../../../../packages/shared/src/index.js').AnalyzeRequest }
  | { ok: false; url: string; manquants: string[] };

/** Réponse du service worker à une demande d'analyse du panneau. */
export type ReponseAnalyse =
  | { ok: true; resultat: import('../../../../packages/shared/src/index.js').AnalysisResult }
  | { ok: false; erreur: 'reseau' | 'serveur'; detail: string };
