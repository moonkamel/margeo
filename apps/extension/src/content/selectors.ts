/**
 * SEULS sélecteurs de page utilisés par l'extension (règle B, décision du 2026-11-03) : si Vinted
 * change son DOM, c'est le seul fichier à corriger.
 *
 * ⚠️ AUCUN de ces sélecteurs n'a encore été vérifié sur une vraie page : l'environnement de
 * développement n'a pas accès à vinted.fr. Chaque champ a plusieurs candidats, essayés dans
 * l'ordre ; le premier qui donne un texte non vide l'emporte. À vérifier sur une page réelle
 * (dernière vérification : JAMAIS — mettre la date ici après vérification).
 */
export const SELECTEURS = {
  /** Titre de l'annonce. Non vérifié. */
  titre: ['[data-testid="item-page-summary-plugin"] h1', 'h1[itemprop="name"]', 'main h1'],
  /** Prix affiché (ex. « 35,00 € »). Non vérifié. */
  prix: ['[data-testid="item-price"]', '[data-testid="item-page-price"]', '[itemprop="price"]'],
  /** Marque. Non vérifié. */
  marque: [
    '[data-testid="item-attributes-brand"] [itemprop="name"]',
    '[itemprop="brand"] [itemprop="name"]',
    '[data-testid="item-attributes-brand"] a',
  ],
  /** Taille. Non vérifié. */
  taille: ['[data-testid="item-attributes-size"] [itemprop="value"]', '[itemprop="size"]'],
  /** État (ex. « Très bon état »). Non vérifié. */
  etat: ['[data-testid="item-attributes-status"] [itemprop="value"]', '[itemprop="itemCondition"]'],
  /** Fil d'Ariane (catégorie). Non vérifié. */
  filAriane: ['[data-testid="breadcrumbs"] a', 'nav[aria-label*="readcrumb"] a'],
} as const;
