/**
 * Alias de marques (doc 2b, section 7) — logique PURE.
 *
 * Comparaison : casse et espaces de début/fin ignorés, accents CONSERVÉS (« Sezane » a besoin
 * de son alias pour rejoindre « Sézane »). Seuls les alias validés rattachent une annonce ;
 * un texte inconnu n'est rattaché à AUCUNE marque (jamais de rapprochement approximatif).
 */

export interface BrandAliasRow {
  alias: string;
  marque: string;
  valide: boolean;
}

export class BrandAliasError extends Error {
  override readonly name = 'BrandAliasError';
}

export const normMarque = (v: string): string => v.trim().toLowerCase();

export class BrandResolver {
  private readonly parAlias = new Map<string, string>();
  private readonly nonValides = new Map<string, string[]>();

  /**
   * @param canoniques marques canoniques des cellules (elles se rattachent à elles-mêmes).
   * @param aliases lignes de la table BrandAlias.
   */
  constructor(canoniques: readonly string[], aliases: readonly BrandAliasRow[]) {
    const poser = (texte: string, marque: string) => {
      const k = normMarque(texte);
      const deja = this.parAlias.get(k);
      if (deja !== undefined && deja !== marque) {
        throw new BrandAliasError(
          `Alias ambigu : « ${texte} » rattaché à la fois à « ${deja} » et à « ${marque} »`,
        );
      }
      this.parAlias.set(k, marque);
    };
    for (const m of canoniques) poser(m, m);
    for (const a of aliases) {
      if (a.valide) poser(a.alias, a.marque);
      else {
        const k = normMarque(a.marque);
        this.nonValides.set(k, [...(this.nonValides.get(k) ?? []), a.alias]);
      }
    }
  }

  /** Marque canonique d'un texte de marque d'annonce, ou null s'il n'est rattaché à rien. */
  resolve(texte: string | null): string | null {
    if (texte === null) return null;
    return this.parAlias.get(normMarque(texte)) ?? null;
  }

  /** Alias non validés d'une marque : la cellule correspondante ne doit pas être crawlée. */
  aliasNonValides(marque: string): string[] {
    return this.nonValides.get(normMarque(marque)) ?? [];
  }
}
