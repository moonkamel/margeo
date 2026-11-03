import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { BrandResolver } from './brand-alias.js';
import { CIBLE_PAR_TIER, type Cellule } from './types.js';

/**
 * Fichier de cellules du seed. Chaque cellule porte obligatoirement `tier`, `cibleActives`
 * (qui doit correspondre au tier) et `valide`. Une cellule n'est crawlable que si elle est
 * validée (`valide: true`) ET si son identifiant de catalogue est connu (`catalogId`).
 */
const celluleSchema = z
  .object({
    categorie: z.string().min(1),
    catalogId: z.number().int().positive().nullable(),
    /** Identifiant de marque Vinted : informatif, non utilisé pour la recherche (texte + alias). */
    brandId: z.number().int().positive().optional(),
    marque: z.string().min(1),
    taille: z.string().min(1).nullable().default(null),
    tier: z.enum(['priority', 'secondary', 'tertiary']),
    cibleActives: z.number().int().positive(),
    valide: z.boolean(),
    justification: z.string().optional(),
  })
  .refine((c) => c.cibleActives === CIBLE_PAR_TIER[c.tier], {
    message: 'cibleActives ne correspond pas au tier (priority 70, secondary 30, tertiary 20)',
    path: ['cibleActives'],
  });

const fichierSchema = z.object({
  _note: z.string().optional(),
  cellules: z.array(celluleSchema).min(1),
});

export type CelluleConfig = z.infer<typeof celluleSchema>;

export class SeedConfigError extends Error {
  override readonly name = 'SeedConfigError';
}

const nomCellule = (c: Pick<CelluleConfig, 'categorie' | 'marque'>) => `${c.categorie}|${c.marque}`;

/**
 * Lit et valide le fichier, sans exiger que les cellules soient crawlables (dry-run).
 * `filtre` : « Catégorie|Marque » ou « catalogId|Marque », insensible à la casse.
 */
export function readCellules(path: string, filtre?: string): CelluleConfig[] {
  let parsed;
  try {
    parsed = fichierSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new SeedConfigError(`Fichier de cellules invalide (${path}) : ${String(err)}`);
  }
  const vus = new Set<string>();
  for (const c of parsed.cellules) {
    const cle = `${c.catalogId ?? c.categorie}|${c.marque.trim().toLowerCase()}|${c.taille ?? '*'}`;
    if (vus.has(cle)) throw new SeedConfigError(`Cellule en double : ${nomCellule(c)}`);
    vus.add(cle);
  }
  if (!filtre) return parsed.cellules;
  const [gauche, marque] = filtre.split('|').map((s) => s.trim().toLowerCase());
  const cellules = parsed.cellules.filter(
    (c) =>
      (c.categorie.toLowerCase() === gauche || String(c.catalogId) === gauche) &&
      c.marque.toLowerCase() === marque,
  );
  if (cellules.length === 0)
    throw new SeedConfigError(`Aucune cellule ne correspond à « ${filtre} »`);
  return cellules;
}

/** Raisons pour lesquelles une cellule ne peut pas être crawlée (vide = crawlable). */
export function motifsRefus(c: CelluleConfig, resolver?: BrandResolver): string[] {
  const motifs: string[] = [];
  if (!c.valide) motifs.push('non validée (valide: false)');
  if (c.catalogId === null) motifs.push('identifiant de catalogue inconnu (catalogId: null)');
  const nonValides = resolver?.aliasNonValides(c.marque) ?? [];
  if (nonValides.length > 0) motifs.push(`alias non validés : ${nonValides.join(', ')}`);
  return motifs;
}

/** Cellules crawlables uniquement : la moindre cellule refusée fait échouer le chargement. */
export function cellulesExecutables(
  configs: readonly CelluleConfig[],
  resolver?: BrandResolver,
): Cellule[] {
  const refus = configs
    .map((c) => ({ c, motifs: motifsRefus(c, resolver) }))
    .filter((x) => x.motifs.length > 0);
  if (refus.length > 0) {
    throw new SeedConfigError(
      `Cellules non crawlables :\n${refus.map((x) => `- ${nomCellule(x.c)} : ${x.motifs.join(' ; ')}`).join('\n')}`,
    );
  }
  return configs.map(({ categorie, catalogId, marque, taille, tier, cibleActives }) => ({
    categorie,
    catalogId: catalogId as number,
    marque,
    taille,
    tier,
    cibleActives,
  }));
}

/**
 * Sélection du run --execute : seules les cellules VALIDÉES sont crawlées, les autres sont
 * ignorées (et listées). Une cellule validée mais non crawlable (catalogue inconnu, alias non
 * validé) fait échouer le chargement : jamais de crawl partiel silencieux d'une cellule validée.
 */
export function cellulesValidees(
  configs: readonly CelluleConfig[],
  resolver?: BrandResolver,
): { cellules: Cellule[]; ignorees: string[] } {
  const validees = configs.filter((c) => c.valide);
  if (validees.length === 0) throw new SeedConfigError('Aucune cellule validée (valide: true)');
  return {
    cellules: cellulesExecutables(validees, resolver),
    ignorees: configs.filter((c) => !c.valide).map(nomCellule),
  };
}

/** Lecture + exigence de crawlabilité (mode --execute). */
export function loadCellules(path: string, filtre?: string, resolver?: BrandResolver): Cellule[] {
  return cellulesExecutables(readCellules(path, filtre), resolver);
}

/** Variables d'environnement obligatoires : échec immédiat avec un message actionnable. */
export function requireSeedEnv(env: Record<string, string | undefined>): {
  apifyToken: string;
  apifyActorId: string;
  databaseUrl: string;
} {
  const manquantes: string[] = [];
  const msg: Record<string, string> = {
    APIFY_TOKEN: 'APIFY_TOKEN manquant, configurer le secret',
    APIFY_ACTOR_ID:
      'APIFY_ACTOR_ID manquant, configurer la variable (acteur retenu après comparatif)',
    DATABASE_URL: 'DATABASE_URL manquant, configurer le secret (base de production)',
  };
  for (const k of Object.keys(msg)) if (!env[k]?.trim()) manquantes.push(msg[k] as string);
  if (manquantes.length > 0) throw new SeedConfigError(manquantes.join('\n'));
  return {
    apifyToken: env['APIFY_TOKEN'] as string,
    apifyActorId: env['APIFY_ACTOR_ID'] as string,
    databaseUrl: env['DATABASE_URL'] as string,
  };
}
