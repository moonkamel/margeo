import type { AnalyzeRequest, Lecture } from '../lib/contrat.js';
import { SELECTEURS } from './selectors.js';

/** Lecteur de page minimal (DOM réel en production, faux lecteur en test). */
export interface Page {
  texte(selecteur: string): string | null;
  textes(selecteur: string): string[];
  /** Attribut `content` (micro-données), utile pour un prix lisible par machine. */
  contenu(selecteur: string): string | null;
}

/** Lecteur sur un `Document` réel. */
export function pageDepuisDocument(doc: Document): Page {
  const nettoie = (t: string | null | undefined) => t?.replace(/\s+/g, ' ').trim() || null;
  return {
    texte: (s) => nettoie(doc.querySelector(s)?.textContent),
    textes: (s) =>
      [...doc.querySelectorAll(s)]
        .map((e) => nettoie(e.textContent))
        .filter((t): t is string => !!t),
    contenu: (s) => nettoie(doc.querySelector(s)?.getAttribute('content')),
  };
}

const ITEM = /^\/items\/(\d+)(?:[-/]|$)/;

/** Identifiant d'annonce si l'URL est une page d'annonce vinted.fr, sinon null. */
export function idAnnonce(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^(www\.)?vinted\.fr$/.test(u.hostname)) return null;
    return ITEM.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** « 1 234,50 € », « 35 € », « 35.00 » → centimes ; null si illisible. Jamais deviné. */
export function prixEnCentimes(texte: string | null): number | null {
  if (!texte) return null;
  const m = /(\d[\d\s  ]*)(?:[,.](\d{1,2}))?/.exec(texte);
  if (!m?.[1]) return null;
  const euros = Number(m[1].replace(/[\s  ]/g, ''));
  const cents = Number((m[2] ?? '0').padEnd(2, '0'));
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

const premier = (page: Page, candidats: readonly string[]) => {
  for (const s of candidats) {
    const t = page.texte(s);
    if (t) return t;
  }
  return null;
};

/**
 * Lit l'annonce sur la page. Règle A : sans titre, prix ET marque, aucun résultat partiel —
 * échec explicite avec la liste des champs manquants. Règle C : uniquement ces huit champs.
 */
export function lireAnnonce(page: Page, url: string): Lecture {
  const externalId = idAnnonce(url);
  const titre = premier(page, SELECTEURS.titre);
  const prixMachine = SELECTEURS.prix.map((s) => page.contenu(s)).find((v) => v) ?? null;
  const prixCents = prixEnCentimes(prixMachine ?? premier(page, SELECTEURS.prix));
  const marque = premier(page, SELECTEURS.marque);

  const manquants = [
    externalId ? null : 'identifiant',
    titre ? null : 'titre',
    prixCents ? null : 'prix',
    marque ? null : 'marque',
  ].filter((m): m is string => m !== null);
  if (manquants.length > 0 || !externalId || !titre || !prixCents || !marque)
    return { ok: false, url, manquants };

  const ariane = SELECTEURS.filAriane.map((s) => page.textes(s)).find((l) => l.length > 0) ?? [];
  const annonce: AnalyzeRequest = {
    externalId,
    url: url.split(/[?#]/)[0] ?? url,
    titre: titre.slice(0, 300),
    prixCents,
    marque: marque.slice(0, 100),
    taille: premier(page, SELECTEURS.taille)?.slice(0, 50) ?? null,
    etat: premier(page, SELECTEURS.etat)?.slice(0, 50) ?? null,
    categorie: ariane.length > 0 ? ariane.join(' > ').slice(0, 200) : null,
  };
  return { ok: true, annonce };
}
