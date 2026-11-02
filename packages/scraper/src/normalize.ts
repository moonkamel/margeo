import { normalizedListingSchema, type Etat, type NormalizedListing } from '@margeo/shared';
import { adaptActorItem } from './adapters/abotapi.js';
import { isDeletedPayload, isSoldPayload } from './detection.js';

/**
 * Normalisation des annonces Vinted.
 *
 * Les drivers ne renvoient pas tous la même forme : l'API interne Vinted (`brand_title`,
 * `status_id`, `price: { amount, currency_code }`…) ou une sortie « aplatie » d'acteur Apify
 * (`brand`, `condition`, `price: 59.9`…). Le mapping est volontairement tolérant sur la FORME,
 * mais strict sur le FOND : un champ indispensable au calcul (prix, devise, état) qu'on ne peut
 * pas lire avec certitude fait échouer la normalisation plutôt que d'être deviné.
 */

export type NormalizeWarning =
  | 'categorie_inconnue'
  | 'marque_absente'
  | 'taille_absente'
  | 'vendeur_incomplet'
  | 'photos_ignorees';

export type NormalizeFailureReason = 'deleted' | 'invalid_payload' | 'unsupported_currency';

export type NormalizeResult =
  | { ok: true; listing: NormalizedListing; warnings: NormalizeWarning[] }
  | { ok: false; reason: NormalizeFailureReason; detail: string };

export const CATEGORIE_INCONNUE = 'inconnue';
const VINTED_BASE_URL = 'https://www.vinted.fr';
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function int(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Premier champ non vide parmi plusieurs noms possibles. */
function pick(raw: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function nested(raw: Raw, key: string, field: string): unknown {
  const obj = raw[key];
  return isRecord(obj) ? obj[field] : undefined;
}

/**
 * Convertit un prix en centimes SANS passer par un flottant intermédiaire quand c'est une chaîne
 * (« 12.5 », « 12,50 », « 1 234,00 »), pour éviter les erreurs d'arrondi binaire.
 */
export function parsePriceToCents(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  }
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(cleaned);
  if (!m) return null;
  const euros = Number(m[1]);
  const centimes = Number((m[2] ?? '0').padEnd(2, '0'));
  return euros * 100 + centimes;
}

function readPrice(raw: Raw): { cents: number | null; currency: string | null } {
  const price = raw['price'];
  if (isRecord(price)) {
    return {
      cents: parsePriceToCents(price['amount']),
      currency: str(price['currency_code']) ?? str(price['currency']),
    };
  }
  return {
    cents: parsePriceToCents(price ?? raw['price_numeric']),
    currency: str(pick(raw, 'currency', 'currency_code')),
  };
}

/** Correspondance status_id Vinted → état. */
const ETAT_PAR_STATUS_ID: Readonly<Record<number, Etat>> = {
  6: 'NEUF_AVEC_ETIQUETTE',
  1: 'NEUF_SANS_ETIQUETTE',
  2: 'TRES_BON',
  3: 'BON',
  4: 'SATISFAISANT',
};

const sansAccents = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Libellés FR et EN reconnus (comparaison sans accents ni casse). */
const ETAT_PAR_LIBELLE: Readonly<Record<string, Etat>> = {
  'neuf avec etiquette': 'NEUF_AVEC_ETIQUETTE',
  'new with tags': 'NEUF_AVEC_ETIQUETTE',
  'neuf sans etiquette': 'NEUF_SANS_ETIQUETTE',
  'new without tags': 'NEUF_SANS_ETIQUETTE',
  'tres bon etat': 'TRES_BON',
  'very good': 'TRES_BON',
  'bon etat': 'BON',
  good: 'BON',
  satisfaisant: 'SATISFAISANT',
  satisfactory: 'SATISFAISANT',
};

export function parseEtat(raw: Raw): Etat | null {
  const id = int(raw['status_id']);
  if (id !== null && ETAT_PAR_STATUS_ID[id]) return ETAT_PAR_STATUS_ID[id];
  const label = str(pick(raw, 'condition', 'status'));
  return label === null ? null : (ETAT_PAR_LIBELLE[sansAccents(label)] ?? null);
}

function readCategorie(raw: Raw): { categorie: string; connue: boolean } {
  const path = raw['category_path'];
  const fromPath = Array.isArray(path) ? str(path[path.length - 1]) : null;
  const titre =
    str(pick(raw, 'catalog_title', 'category_title', 'category')) ??
    str(nested(raw, 'catalog', 'title')) ??
    fromPath;
  if (titre !== null) return { categorie: titre, connue: true };
  // On ne devine pas un libellé à partir d'un identifiant : la catégorie reste traçable.
  const catalogId = int(raw['catalog_id']);
  return {
    categorie: catalogId !== null ? `catalogue-${catalogId}` : CATEGORIE_INCONNUE,
    connue: false,
  };
}

function readPhotos(raw: Raw): { photos: string[]; ignorees: boolean } {
  const list = pick(raw, 'photos', 'images', 'photo_urls');
  if (!Array.isArray(list)) return { photos: [], ignorees: false };
  const photos: string[] = [];
  let ignorees = false;
  for (const p of list) {
    const candidate = isRecord(p) ? (str(p['full_size_url']) ?? str(p['url'])) : str(p);
    if (candidate !== null && URL.canParse(candidate) && candidate.startsWith('http')) {
      photos.push(candidate);
    } else {
      ignorees = true;
    }
  }
  return { photos, ignorees };
}

function readUrl(raw: Raw, externalId: string): string {
  const u = str(raw['url']);
  if (u !== null) {
    if (URL.canParse(u)) return u;
    if (u.startsWith('/')) return `${VINTED_BASE_URL}${u}`;
  }
  return `${VINTED_BASE_URL}/items/${externalId}`;
}

function readVendeur(
  raw: Raw,
  now: Date,
): { vendeur: NormalizedListing['vendeur']; complet: boolean } {
  const u = isRecord(raw['user']) ? raw['user'] : isRecord(raw['seller']) ? raw['seller'] : {};
  const pseudo = str(pick(u, 'login', 'username', 'name')) ?? str(raw['seller_name']) ?? '';

  // Vinted exprime la réputation entre 0 et 1 ; les sorties aplaties souvent sur 5.
  let note: number | null = null;
  const reputation = u['feedback_reputation'];
  const rating = u['rating'];
  if (typeof reputation === 'number' && reputation >= 0 && reputation <= 1) {
    note = Math.round(reputation * 50) / 10;
  } else if (typeof rating === 'number' && rating >= 0 && rating <= 5) {
    note = Math.round(rating * 10) / 10;
  }

  const inscrit = str(pick(u, 'created_at', 'memberSince', 'member_since'));
  const inscritMs = inscrit === null ? NaN : Date.parse(inscrit);
  const ancienneteJours =
    Number.isFinite(inscritMs) && inscritMs <= now.getTime()
      ? Math.floor((now.getTime() - inscritMs) / MS_PAR_JOUR)
      : null;

  const vendeur = {
    pseudo,
    ancienneteJours,
    note,
    nbEvaluations: int(pick(u, 'feedback_count', 'reviews', 'reviews_count')),
  };
  return {
    vendeur,
    complet:
      pseudo !== '' && note !== null && ancienneteJours !== null && vendeur.nbEvaluations !== null,
  };
}

/**
 * Normalise un item brut. `now` est injecté pour que le calcul d'ancienneté reste déterministe.
 */
export function normalizeVintedItem(raw: unknown, now: Date = new Date()): NormalizeResult {
  const input = adaptActorItem(raw);
  if (!isRecord(input)) {
    return { ok: false, reason: 'invalid_payload', detail: 'payload non objet' };
  }
  if (isDeletedPayload(input)) {
    return { ok: false, reason: 'deleted', detail: 'annonce supprimée ou introuvable' };
  }

  const externalId = str(pick(input, 'id', 'item_id', 'itemId'));
  const titre = str(input['title']);
  if (externalId === null || titre === null) {
    return { ok: false, reason: 'invalid_payload', detail: 'identifiant ou titre manquant' };
  }

  const { cents, currency } = readPrice(input);
  if (cents === null) {
    return { ok: false, reason: 'invalid_payload', detail: 'prix illisible ou absent' };
  }
  if (currency !== null && currency.toUpperCase() !== 'EUR') {
    return { ok: false, reason: 'unsupported_currency', detail: `devise ${currency} non gérée` };
  }

  const etat = parseEtat(input);
  if (etat === null) {
    return { ok: false, reason: 'invalid_payload', detail: 'état de l’article non reconnu' };
  }

  const warnings: NormalizeWarning[] = [];
  const { categorie, connue } = readCategorie(input);
  if (!connue) warnings.push('categorie_inconnue');

  const marque =
    str(pick(input, 'brand_title', 'brand')) ?? str(nested(input, 'brand_dto', 'title'));
  if (marque === null) warnings.push('marque_absente');
  const taille = str(pick(input, 'size_title', 'size'));
  if (taille === null) warnings.push('taille_absente');

  const { photos, ignorees } = readPhotos(input);
  if (ignorees) warnings.push('photos_ignorees');
  const { vendeur, complet } = readVendeur(input, now);
  if (!complet) warnings.push('vendeur_incomplet');

  const candidate: NormalizedListing = {
    plateforme: 'VINTED',
    externalId,
    url: readUrl(input, externalId),
    titre,
    marque,
    categorie,
    taille,
    etat,
    prixCents: cents,
    favoris: int(pick(input, 'favourite_count', 'favourites', 'likes')) ?? 0,
    vues: int(pick(input, 'view_count', 'views')) ?? 0,
    photos,
    description: str(input['description']) ?? '',
    vendeur,
    statut: isSoldPayload(input) ? 'sold' : 'active',
  };

  // Dernier filet : la sortie respecte toujours le schéma partagé.
  const parsed = normalizedListingSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_payload', detail: 'annonce normalisée non conforme' };
  }
  return { ok: true, listing: parsed.data, warnings };
}
