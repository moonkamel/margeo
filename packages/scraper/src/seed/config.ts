import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Cellule } from './types.js';

/**
 * Fichier de cellules du seed. Chaque cellule doit être explicitement validée
 * (`valide: true`) avant de pouvoir être crawlée : aucune dépense sur une cellule proposée.
 */
const celluleSchema = z.object({
  categorie: z.string().min(1),
  marque: z.string().min(1),
  taille: z.string().min(1).nullable().default(null),
  valide: z.boolean(),
  justification: z.string().optional(),
});

const fichierSchema = z.object({
  _note: z.string().optional(),
  cellules: z.array(celluleSchema).min(1),
});

export class SeedConfigError extends Error {
  override readonly name = 'SeedConfigError';
}

export function loadCellules(path: string, filtre?: string): Cellule[] {
  let parsed;
  try {
    parsed = fichierSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    throw new SeedConfigError(`Fichier de cellules invalide (${path}) : ${String(err)}`);
  }
  let cellules = parsed.cellules;
  if (filtre) {
    const [categorie, marque] = filtre.split('|').map((s) => s.trim().toLowerCase());
    cellules = cellules.filter(
      (c) => c.categorie.toLowerCase() === categorie && c.marque.toLowerCase() === marque,
    );
    if (cellules.length === 0)
      throw new SeedConfigError(`Aucune cellule ne correspond à « ${filtre} »`);
  }
  const nonValidees = cellules.filter((c) => !c.valide);
  if (nonValidees.length > 0) {
    throw new SeedConfigError(
      `Cellules non validées (valide: false) : ${nonValidees.map((c) => `${c.categorie}|${c.marque}`).join(', ')}`,
    );
  }
  return cellules.map(({ categorie, marque, taille }) => ({ categorie, marque, taille }));
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
