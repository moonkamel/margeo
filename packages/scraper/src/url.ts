import { ScraperError } from './errors.js';

const ITEM_PATH = /^\/items\/(\d+)(?:[-/]|$)/;

/**
 * Valide une URL d'annonce vinted.fr et en extrait l'identifiant.
 * Exemple : https://www.vinted.fr/items/4817263512-jean-levis → « 4817263512 ».
 */
export function parseVintedItemUrl(url: string): { externalId: string; canonicalUrl: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ScraperError('invalid_url', `URL illisible : ${url}`);
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || (host !== 'vinted.fr' && host !== 'www.vinted.fr')) {
    throw new ScraperError('invalid_url', `Hôte non supporté : ${host}`);
  }
  const m = ITEM_PATH.exec(u.pathname);
  if (!m?.[1]) throw new ScraperError('invalid_url', `Chemin non reconnu : ${u.pathname}`);
  return {
    externalId: m[1],
    canonicalUrl: `https://www.vinted.fr${u.pathname.replace(/\/+$/, '')}`,
  };
}

/** URL de recherche catalogue vinted.fr pour (catégorie, marque, taille), en texte libre. */
export function buildCatalogSearchUrl(
  category: string,
  brand: string | null,
  size: string | null,
): string {
  const terms = [brand, category, size].filter((t): t is string => t !== null && t.trim() !== '');
  const u = new URL('https://www.vinted.fr/catalog');
  u.searchParams.set('search_text', terms.join(' '));
  u.searchParams.set('order', 'newest_first');
  return u.toString();
}
