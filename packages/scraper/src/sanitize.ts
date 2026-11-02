/**
 * Minimisation RGPD des payloads bruts avant stockage (décision du 2026-11-04).
 *
 * ALLOWLIST, pas blocklist : un champ inconnu (ex. `sellerEmail` ajouté demain par un acteur)
 * n'est JAMAIS stocké par défaut. Aucune donnée vendeur (`seller*`, `user`…), aucune
 * `description` (texte libre pouvant contenir adresse, nom, téléphone), aucune photo.
 *
 * La normalisation et la détection de vente lisent le payload brut AVANT ce filtrage :
 * seule la copie stockée (`ListingObservation.payload`) est réduite.
 *
 * Toute évolution de cette liste doit être validée. Retirés le 2026-11-04 : `itemClosingAction`,
 * `item_closing_action` (ambigus : actions de modération Vinted, non utilisés).
 */

/** Champs scalaires conservés tels quels (noms de chaque source pour un même sens). */
const CHAMPS_AUTORISES: ReadonlySet<string> = new Set([
  // Liste validée le 2026-11-04.
  'itemId',
  'title',
  'url',
  'price',
  'currency',
  'catalogId',
  'categoryId',
  'categoryPath',
  'brand',
  'brandId',
  'size',
  'sizeId',
  'condition',
  'isReserved',
  'isHidden',
  'isClosed',
  'isSold',
  'favouriteCount',
  'viewCount',
  'colors',
  'createdAt',
  'scrapedAt',
  // Mêmes champs sous d'autres noms (kazkn, API Vinted, abotapi) — à valider.
  'id',
  'item_id',
  'priceAmount',
  'price_numeric',
  'currency_code',
  'brandTitle',
  'brand_title',
  'catalog_id',
  'catalog_title',
  'category_title',
  'size_title',
  'size_id',
  'status',
  'status_id',
  'is_reserved',
  'is_hidden',
  'is_closed',
  'is_sold',
  'sold',
  'favourite_count',
  'view_count',
  'created_at',
]);

/** Sous-champs conservés pour les champs autorisés qui sont des objets. */
const SOUS_CHAMPS: Readonly<Record<string, ReadonlySet<string>>> = {
  brand: new Set(['id', 'title', 'slug']),
  price: new Set(['amount', 'currency_code']),
};

const estScalaire = (v: unknown) =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);

function valeurAutorisee(cle: string, v: unknown): unknown {
  if (estScalaire(v)) return v;
  if (Array.isArray(v)) {
    const scalaires = v.filter(estScalaire);
    return scalaires.length === v.length ? scalaires : undefined; // ex. colors: ['Gris']
  }
  const sous = SOUS_CHAMPS[cle];
  if (sous && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      if (sous.has(k) && estScalaire(x)) out[k] = x;
    return out;
  }
  return undefined; // objet ou structure non prévue : non stocké
}

export function sanitizeListingPayload(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!CHAMPS_AUTORISES.has(cle)) continue;
    const garde = valeurAutorisee(cle, v);
    if (garde !== undefined) out[cle] = garde;
  }
  return out;
}
