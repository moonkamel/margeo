import { describe, expect, it } from 'vitest';
import { idAnnonce, lireAnnonce, prixEnCentimes, type Page } from '../src/content/extract.js';
import { SELECTEURS } from '../src/content/selectors.js';

/** Fausse page : sélecteur → texte(s). Aucune page réelle n'a pu être utilisée (accès bloqué). */
function page(champs: Partial<Record<keyof typeof SELECTEURS, string | string[]>>): Page {
  const parSelecteur = new Map<string, string[]>();
  for (const [cle, valeur] of Object.entries(champs)) {
    const sel = SELECTEURS[cle as keyof typeof SELECTEURS][0] as string;
    parSelecteur.set(sel, Array.isArray(valeur) ? valeur : [valeur]);
  }
  return {
    texte: (s) => parSelecteur.get(s)?.[0] ?? null,
    textes: (s) => parSelecteur.get(s) ?? [],
    contenu: () => null,
  };
}
const URL_ANNONCE = 'https://www.vinted.fr/items/4817263512-pull-sezane?referrer=catalog#photos';

describe('idAnnonce', () => {
  it.each([
    [URL_ANNONCE, '4817263512'],
    ['https://vinted.fr/items/42', '42'],
    ['https://www.vinted.fr/catalog/13-jumpers', null],
    ['https://www.vinted.de/items/42-x', null],
    ['pas une url', null],
  ])('%s → %s', (url, id) => expect(idAnnonce(url)).toBe(id));
});

describe('prixEnCentimes', () => {
  it.each([
    ['35,00 €', 3500],
    ['35 €', 3500],
    ['1 234,50 €', 123450],
    ['12.9', 1290],
    ['', null],
    ['Gratuit', null],
    ['0,00 €', null],
  ])('« %s » → %s', (t, c) => expect(prixEnCentimes(t)).toBe(c));
});

describe('lireAnnonce', () => {
  it('annonce complète : les 8 champs autorisés, URL sans paramètres', () => {
    const r = lireAnnonce(
      page({
        titre: 'Pull Sézane en laine',
        prix: '35,00 €',
        marque: 'Sézane',
        taille: 'M',
        etat: 'Très bon état',
        filAriane: ['Femmes', 'Vêtements', 'Pulls'],
      }),
      URL_ANNONCE,
    );
    expect(r).toEqual({
      ok: true,
      annonce: {
        externalId: '4817263512',
        url: 'https://www.vinted.fr/items/4817263512-pull-sezane',
        titre: 'Pull Sézane en laine',
        prixCents: 3500,
        marque: 'Sézane',
        taille: 'M',
        etat: 'Très bon état',
        categorie: 'Femmes > Vêtements > Pulls',
      },
    });
  });

  it('taille, état, catégorie absents : acceptés (null)', () => {
    const r = lireAnnonce(
      page({ titre: 'AirPods Pro', prix: '120 €', marque: 'Apple' }),
      URL_ANNONCE,
    );
    expect(r.ok && r.annonce).toMatchObject({ taille: null, etat: null, categorie: null });
  });

  it.each([
    [{ prix: '35 €', marque: 'Sézane' }, ['titre']],
    [{ titre: 'Pull', marque: 'Sézane' }, ['prix']],
    [{ titre: 'Pull', prix: '35 €' }, ['marque']],
    [{}, ['titre', 'prix', 'marque']],
  ])('règle A — %j : échec explicite, aucun résultat partiel', (champs, manquants) => {
    expect(lireAnnonce(page(champs), URL_ANNONCE)).toEqual({
      ok: false,
      url: URL_ANNONCE,
      manquants,
    });
  });

  it('page qui n’est pas une annonce → identifiant manquant', () => {
    const r = lireAnnonce(page({ titre: 'x', prix: '1 €', marque: 'y' }), 'https://www.vinted.fr/');
    expect(r).toMatchObject({ ok: false, manquants: ['identifiant'] });
  });

  it('prix lisible par machine (attribut content) prioritaire sur le texte affiché', () => {
    const p = page({ titre: 'Pull', prix: 'à partir de 99 €', marque: 'Sézane' });
    const r = lireAnnonce(
      { ...p, contenu: (s) => (s === SELECTEURS.prix[0] ? '35.00' : null) },
      URL_ANNONCE,
    );
    expect(r.ok && r.annonce.prixCents).toBe(3500);
  });
});
