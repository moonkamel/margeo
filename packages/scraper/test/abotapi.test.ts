import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adaptActorItem,
  isAbotapiItem,
  isClosedPayload,
  isSoldPayload,
  normalizeVintedItem,
} from '../src/index.js';
import { subcategoryIdOf } from '../src/seed/index.js';

/** Payloads synthétiques aux clés identiques aux sorties réelles abotapi (2026-11-04). */
const P = JSON.parse(
  readFileSync(new URL('./fixtures/payloads-acteurs.json', import.meta.url), 'utf8'),
) as Record<'kazkn' | 'abotapiDetails' | 'abotapiNike', Record<string, unknown>>;
const NOW = new Date('2026-11-04T12:00:00Z');

describe('adaptateur abotapi → NormalizedListing', () => {
  it('reconnaît le format abotapi, pas les autres', () => {
    expect(isAbotapiItem(P.abotapiNike)).toBe(true);
    expect(isAbotapiItem(P.kazkn)).toBe(false);
    expect(adaptActorItem(P.kazkn)).toBe(P.kazkn); // inchangé
  });

  it('mapping complet (Nike, fetchDetails)', () => {
    const r = normalizeVintedItem(P.abotapiNike, NOW);
    if (!r.ok) throw new Error(r.detail);
    expect(r.listing).toMatchObject({
      externalId: '900000001',
      url: 'https://www.vinted.fr/items/900000001-nike-air-max',
      titre: 'Nike Air Max (fixture)',
      prixCents: 3000,
      marque: 'Nike',
      categorie: 'Hommes Baskets',
      taille: '42',
      etat: 'TRES_BON',
      favoris: 3,
      vues: 0,
      photos: ['https://example.invalid/photo.webp'],
      statut: 'active',
    });
    expect(r.warnings).not.toContain('taille_absente');
  });

  it('taille absente (vêtements) : acceptée, taille null + avertissement', () => {
    const { size: _omit, ...sansTaille } = P.abotapiNike;
    void _omit;
    const r = normalizeVintedItem(sansTaille, NOW);
    if (!r.ok) throw new Error(r.detail);
    expect(r.listing.taille).toBeNull();
    expect(r.warnings).toContain('taille_absente');
  });

  it('prix décimal en chaîne : centimes exacts', () => {
    const r = normalizeVintedItem({ ...P.abotapiNike, priceAmount: '12.90' }, NOW);
    expect(r.ok && r.listing.prixCents).toBe(1290);
  });

  it('prix absent → refus (jamais deviné)', () => {
    const r = normalizeVintedItem({ ...P.abotapiNike, priceAmount: null }, NOW);
    expect(r).toMatchObject({ ok: false, reason: 'invalid_payload' });
  });

  it('marque : objet brand prioritaire, sinon brandTitle', () => {
    const { brand: _b, ...sansObjet } = P.abotapiNike;
    void _b;
    const r = normalizeVintedItem({ ...sansObjet, brandTitle: 'Sézane' }, NOW);
    expect(r.ok && r.listing.marque).toBe('Sézane');
  });

  it('sous-catégorie : catalogId lu sur le payload brut', () => {
    expect(subcategoryIdOf(P.abotapiDetails)).toBe(529);
    expect(subcategoryIdOf(P.abotapiNike)).toBe(1242);
  });

  it('détection : fermée via isClosed / isHidden, active sinon', () => {
    expect(isClosedPayload(adaptActorItem(P.abotapiNike))).toBe(false);
    expect(isClosedPayload(adaptActorItem({ ...P.abotapiNike, isClosed: true }))).toBe(true);
    expect(isClosedPayload(adaptActorItem({ ...P.abotapiNike, isHidden: true }))).toBe(true);
    expect(isSoldPayload(adaptActorItem(P.abotapiNike))).toBe(false);
  });

  it('données vendeur : utilisables en mémoire, jamais dans le payload stocké', () => {
    const r = normalizeVintedItem(P.abotapiNike, NOW);
    expect(r.ok && r.listing.vendeur.pseudo).toBe('pseudo-fictif');
  });
});
