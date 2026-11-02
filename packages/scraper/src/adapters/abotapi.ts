/**
 * Adaptateur `abotapi/vinted-fr-scraper` → forme « API Vinted » comprise par le normaliseur
 * et la détection de vente (`id`, `price: { amount, currency_code }`, `brand_title`,
 * `catalog_id`, `is_closed`…). Format observé le 2026-11-04 (mode `search`, `fetchDetails`).
 *
 * Tolérance : `size` est souvent ABSENT sur les vêtements (0 / 5 annonces Sézane, catalogue 13,
 * le 2026-11-04) → `size_title: null`, la normalisation l'accepte (avertissement `taille_absente`).
 */

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Payload au format abotapi : identifiant `itemId` et prix `priceAmount`. */
export function isAbotapiItem(raw: unknown): raw is Raw {
  return isRecord(raw) && raw['itemId'] !== undefined && 'priceAmount' in raw && !('id' in raw);
}

const defini = <T>(v: T | null | undefined): v is T => v !== undefined && v !== null;

function intOuNull(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

export function adaptAbotapiItem(raw: Raw): Raw {
  const brand = isRecord(raw['brand']) ? raw['brand'] : null;
  const seller = isRecord(raw['seller']) ? raw['seller'] : null;
  const out: Raw = {
    id: raw['itemId'],
    title: raw['title'],
    url: raw['url'] ?? raw['path'],
    price: { amount: raw['priceAmount'], currency_code: raw['currency'] },
    brand_title: (brand ? brand['title'] : undefined) ?? raw['brandTitle'] ?? null,
    brand_id: intOuNull(brand ? brand['id'] : raw['brandId']),
    catalog_id: intOuNull(raw['catalogId'] ?? raw['categoryId']),
    // Libellé de la sous-catégorie tel que fourni (ex. « Femmes Pulls d'hiver »).
    catalog_title: raw['categoryPath'] ?? raw['category'] ?? null,
    condition: raw['condition'],
    size_title: raw['size'] ?? null,
    favourite_count: raw['favouriteCount'],
    view_count: raw['viewCount'],
    photos: raw['photos'],
    description: raw['description'],
    is_reserved: raw['isReserved'],
    is_hidden: raw['isHidden'],
    is_closed: raw['isClosed'],
    item_closing_action: raw['itemClosingAction'],
    // Données vendeur : uniquement pour l'analyse en mémoire, jamais stockées
    // (sanitizeListingPayload s'applique au payload d'origine).
    user: {
      login: (seller ? seller['username'] : undefined) ?? raw['sellerUsername'] ?? null,
      feedback_count: raw['sellerFeedbackCount'] ?? (seller ? seller['feedbackCount'] : null),
    },
  };
  // Les champs absents ne sont pas émis : `pick` du normaliseur ignore déjà null/undefined.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => defini(v)));
}

/** Point d'entrée unique : adapte si le payload vient d'abotapi, sinon le renvoie tel quel. */
export function adaptActorItem(raw: unknown): unknown {
  return isAbotapiItem(raw) ? adaptAbotapiItem(raw) : raw;
}

/**
 * Marque brute d'un item, SANS normalisation complète. Sert au comptage de la vérification du
 * volume : sans `fetchDetails`, abotapi ne renvoie pas l'état de l'annonce et la normalisation
 * (qui l'exige) rejetterait tout. `brandTitle` est présent dès la recherche (111 / 111 annonces
 * le 2026-11-04).
 */
export function marqueBrute(raw: unknown): string | null {
  const a = adaptActorItem(raw);
  if (!isRecord(a)) return null;
  const brand = a['brand'];
  const v =
    a['brand_title'] ??
    (typeof brand === 'string' ? brand : isRecord(brand) ? brand['title'] : undefined) ??
    (isRecord(a['brand_dto']) ? a['brand_dto']['title'] : undefined);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
