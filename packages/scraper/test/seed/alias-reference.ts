/**
 * Référence validée (doc 2b, section 7, 2026-11-03 ; sous-gammes 2026-11-04, section 8.13) —
 * identique aux migrations brand_alias et brand_alias_sous_gammes.
 */
export const ALIAS_VALIDES: Record<string, string[]> = {
  'New Balance': ['NewBalance', 'New-Balance', 'New balance', 'new balance'],
  Nike: ['NIKE', 'nike', 'Nike Air', 'Nike x Nocta', 'Nike x Off-White'],
  Adidas: ['ADIDAS', 'adidas', 'Adidas Equipment', 'Adidas Terrex'],
  Sézane: ['Sezane', 'SEZANE', 'Sézane Paris'],
  'AMI Paris': ['Ami Paris', 'ami paris'],
  Sandro: ['SANDRO', 'sandro paris'],
  Maje: ['MAJE', 'maje paris'],
  'Ralph Lauren': ['RALPH LAUREN', 'Polo Ralph Lauren'],
  Apple: ['apple', 'APPLE'],
  Sony: ['SONY', 'sony'],
  Bose: ['BOSE', 'bose'],
  JBL: ['JBL', 'jbl'],
  Samsung: ['SAMSUNG', 'samsung'],
};

/** Jamais rattachés à une cellule (sous-marques ou ambigus). */
export const NON_RATTACHES = ['NB', 'AMI', 'Polo', 'Adidas Originals', 'Jordan', 'Yeezy'];
