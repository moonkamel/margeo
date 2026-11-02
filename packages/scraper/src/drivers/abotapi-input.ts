import { z } from 'zod';
import { ScraperError } from '../errors.js';
import type { ApifyInputBuilders } from './apify.js';

/**
 * Inputs de `abotapi/vinted-fr-scraper` (acteur retenu le 2026-11-04).
 *
 * - Recherche : `{ mode: "search", queries, categoryId (chaîne), maxItems, fetchDetails: true,
 *   sortBy: "newest_first" }` ;
 * - Re-vérification : `{ mode: "url", urls, maxItems, fetchDetails: true }`.
 *
 * `fetchDetails` est toujours explicite (c'est lui qui expose `catalogId`, la sous-catégorie).
 * `maxItems` est toujours présent : c'est le plafond de facturation du run.
 * Schémas STRICTS : un champ non prévu fait échouer la construction, rien n'est envoyé.
 */
export const ABOTAPI_ACTOR_IDS: readonly string[] = [
  'abotapi/vinted-fr-scraper',
  'abotapi~vinted-fr-scraper',
];

const searchInputSchema = z
  .object({
    mode: z.literal('search'),
    queries: z.array(z.string().min(1)).length(1),
    categoryId: z.string().regex(/^\d+$/),
    maxItems: z.number().int().positive(),
    fetchDetails: z.literal(true),
    sortBy: z.literal('newest_first'),
  })
  .strict();

const urlInputSchema = z
  .object({
    mode: z.literal('url'),
    urls: z.array(z.url()).min(1),
    maxItems: z.number().int().positive(),
    fetchDetails: z.literal(true),
  })
  .strict();

export type AbotapiSearchInput = z.infer<typeof searchInputSchema>;
export type AbotapiUrlInput = z.infer<typeof urlInputSchema>;

/** Paramètres d'URL de recherche que l'adaptateur sait traduire ; tout autre est refusé. */
const PARAMS_RECHERCHE = new Set(['catalog[]', 'search_text', 'order']);

/**
 * Traduit une URL de recherche de cellule (`buildCellSearchUrl`) en input abotapi.
 * Exige exactement un catalogue et un texte de recherche ; refuse tout autre filtre plutôt que
 * de l'ignorer en silence (un filtre perdu fausserait la cellule).
 */
export function abotapiSearchInput(searchUrl: string, maxItems: number): AbotapiSearchInput {
  const u = new URL(searchUrl);
  const inconnus = [...new Set(u.searchParams.keys())].filter((k) => !PARAMS_RECHERCHE.has(k));
  if (inconnus.length > 0) {
    throw new ScraperError(
      'invalid_url',
      `Filtre non traduisible pour abotapi : ${inconnus.join(', ')}`,
    );
  }
  const catalogues = u.searchParams.getAll('catalog[]');
  const texte = u.searchParams.get('search_text')?.trim() ?? '';
  const ordre = u.searchParams.get('order');
  if (catalogues.length !== 1 || texte === '' || (ordre !== null && ordre !== 'newest_first')) {
    throw new ScraperError(
      'invalid_url',
      'Recherche abotapi : un seul catalogue, un texte et l’ordre newest_first sont requis',
    );
  }
  return searchInputSchema.parse({
    mode: 'search',
    queries: [texte],
    categoryId: catalogues[0],
    maxItems,
    fetchDetails: true,
    sortBy: 'newest_first',
  });
}

export function abotapiUrlInput(urls: readonly string[]): AbotapiUrlInput {
  return urlInputSchema.parse({
    mode: 'url',
    urls: [...urls],
    maxItems: urls.length,
    fetchDetails: true,
  });
}

export const ABOTAPI_INPUT_BUILDERS: ApifyInputBuilders = {
  listing: (url) => abotapiUrlInput([url]),
  listings: (urls) => abotapiUrlInput(urls),
  search: (searchUrl, maxItems) => abotapiSearchInput(searchUrl, maxItems),
};

/**
 * Builders d'input de l'acteur configuré pour le seed. Un acteur sans mapping validé est refusé :
 * jamais d'input « générique » envoyé à un acteur réel qui l'interpréterait mal.
 */
export function inputBuildersPourActeur(actorId: string): ApifyInputBuilders {
  if (ABOTAPI_ACTOR_IDS.includes(actorId.trim())) return ABOTAPI_INPUT_BUILDERS;
  throw new ScraperError(
    'invalid_response',
    `Acteur « ${actorId} » sans mapping d'input validé (acteur retenu : abotapi/vinted-fr-scraper)`,
  );
}
