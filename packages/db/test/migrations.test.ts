import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * Tests de migration contre un vrai Postgres (`docker compose up`, DATABASE_URL).
 * Chaque scénario travaille dans une base temporaire dédiée, supprimée à la fin.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const sql = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../infra/${rel}`, import.meta.url)), 'utf8');

const INIT = 'migrations/20261102000000_init/migration.sql';
const TRACKED = 'migrations/20261103000000_tracked_listing/migration.sql';
const TRACKED_DOWN = 'rollbacks/20261103000000_tracked_listing.down.sql';
const SEED_RUN = 'migrations/20261103010000_seed_run/migration.sql';
const SUBCAT = 'migrations/20261104000000_tracked_listing_subcategory/migration.sql';
const SUBCAT_DOWN = 'rollbacks/20261104000000_tracked_listing_subcategory.down.sql';
const ALIAS = 'migrations/20261104010000_brand_alias/migration.sql';
const ALIAS_DOWN = 'rollbacks/20261104010000_brand_alias.down.sql';
const S2P = 'migrations/20261104020000_subcategory_to_parent/migration.sql';
const ALIAS2 = 'migrations/20261104040000_brand_alias_sous_gammes/migration.sql';
const ALIAS2_DOWN = 'rollbacks/20261104040000_brand_alias_sous_gammes.down.sql';
const S2P_DOWN = 'rollbacks/20261104020000_subcategory_to_parent.down.sql';

const created: string[] = [];
let admin: pg.Client;

function urlFor(db: string): string {
  const u = new URL(DATABASE_URL ?? '');
  u.pathname = `/${db}`;
  return u.toString();
}

async function freshDb(): Promise<{ name: string; client: pg.Client }> {
  const name = `margeo_migtest_${randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  created.push(name);
  const client = new pg.Client({ connectionString: urlFor(name) });
  await client.connect();
  return { name, client };
}

/** Applique un script dans une transaction : un échec ne laisse rien à moitié appliqué. */
async function apply(client: pg.Client, rel: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql(rel));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

function prisma(args: string[], db: string) {
  return spawnSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: PKG_DIR,
    env: { ...process.env, DATABASE_URL: urlFor(db) },
    encoding: 'utf8',
  });
}

/** Empreinte du schéma (colonnes, types, nullabilité, défauts, index, types enum). */
async function schemaFingerprint(client: pg.Client): Promise<string[]> {
  const cols = await client.query<{ f: string }>(`
    SELECT table_name || '.' || column_name || ':' || udt_name || ':' || is_nullable || ':' || COALESCE(column_default, '') AS f
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`);
  const idx = await client.query<{ f: string }>(`
    SELECT 'index:' || indexdef AS f FROM pg_indexes WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  const enums = await client.query<{ f: string }>(`
    SELECT 'enum:' || t.typname || ':' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS f
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`);
  return [...cols.rows, ...idx.rows, ...enums.rows].map((r) => r.f).sort();
}

/** Données d'une base « existante » au schéma init : annonces observées et ventes. */
async function seedExisting(client: pg.Client): Promise<void> {
  const obs = (id: string, ext: string, prix: number, statut: string, at: string) =>
    client.query(
      `INSERT INTO "ListingObservation" (id, "externalId", plateforme, url, titre, categorie, marque, taille, etat, "prixCents", favoris, vues, statut, payload, "observedAt")
       VALUES ($1, $2, 'VINTED', $3, 'Titre ' || $2, 'Baskets', 'Nike', '42', 'BON', $4, 1, 10, $5, '{}', $6)`,
      [id, ext, `https://www.vinted.fr/items/${ext}-x`, prix, statut, at],
    );
  // A : active, prix en baisse.
  await obs('a1', '100', 3000, 'active', '2026-10-01T08:00:00Z');
  await obs('a2', '100', 2800, 'active', '2026-10-02T08:00:00Z');
  await obs('a3', '100', 2500, 'active', '2026-10-03T08:00:00Z');
  // B : vue active puis vendue, vente déjà enregistrée.
  await obs('b1', '200', 4000, 'active', '2026-10-01T08:00:00Z');
  await obs('b2', '200', 3900, 'sold', '2026-10-05T08:00:00Z');
  // C : vue vendue mais sans vente enregistrée (projection manquante).
  await obs('c1', '300', 5000, 'active', '2026-10-01T08:00:00Z');
  await obs('c2', '300', 5000, 'sold', '2026-10-04T08:00:00Z');
  const sold = (
    id: string,
    ext: string,
    prix: number,
    source: string,
    soldAt: string,
    listedAt: string | null,
  ) =>
    client.query(
      `INSERT INTO "SoldObservation" (id, "externalId", plateforme, "prixVenteCents", etat, categorie, marque, taille, "listedAt", "soldAt", source)
       VALUES ($1, $2, 'VINTED', $3, 'BON', 'Baskets', 'Nike', '42', $4, $5, $6)`,
      [id, ext, prix, listedAt, soldAt, source],
    );
  await sold('sb', '200', 3900, 'sold_status', '2026-10-05T08:00:00Z', '2026-10-01T08:00:00Z');
  // D : disparition sans aucune observation d'annonce.
  await sold('sd', '400', 1500, 'disappeared', '2026-10-06T08:00:00Z', null);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
});

afterAll(async () => {
  if (!DATABASE_URL) return;
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

describe.skipIf(!DATABASE_URL)('migration TrackedListing — base vide', () => {
  it('prisma migrate deploy applique tout et le schéma ne dérive pas de schema.prisma', async () => {
    const { name, client } = await freshDb();
    const deploy = prisma(['migrate', 'deploy'], name);
    expect(deploy.status, deploy.stderr + deploy.stdout).toBe(0);
    const diff = prisma(
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      name,
    );
    expect(diff.status, diff.stdout + diff.stderr).toBe(0); // 0 = aucune différence
    const tables = await client.query(`SELECT to_regclass('"TrackedListing"') AS t`);
    expect(tables.rows[0].t).toBe('"TrackedListing"');
    // Toute table du schéma public doit avoir RLS (API Supabase fermée) : une future migration
    // qui crée une table sans « ENABLE ROW LEVEL SECURITY » fait échouer ce test.
    const sansRls = await client.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`,
    );
    expect(sansRls.rows.map((r) => r.relname)).toEqual([]);
    // Le propriétaire (rôle de Prisma) n'est pas bloqué par RLS sans policy.
    const lecture = await client.query(`SELECT count(*)::int AS n FROM "BrandAlias"`);
    expect(lecture.rows[0].n).toBe(34);
    await client.end();
  });
});

describe.skipIf(!DATABASE_URL)('migration TrackedListing — base existante', () => {
  let client: pg.Client;
  let initFingerprint: string[];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    ({ client } = await freshDb());
    await apply(client, INIT);
    initFingerprint = await schemaFingerprint(client);
    await seedExisting(client);
    await apply(client, TRACKED);
  });
  afterAll(async () => {
    await client?.end();
  });

  const tracked = async (ext: string) =>
    (await client.query(`SELECT * FROM "TrackedListing" WHERE "externalId" = $1`, [ext])).rows[0];

  it('une annonce suivie par externalId, aucune perte', async () => {
    const r = await client.query(`SELECT "externalId" FROM "TrackedListing" ORDER BY 1`);
    expect(r.rows.map((x) => x.externalId)).toEqual(['100', '200', '300', '400']);
    const lo = await client.query(`SELECT count(*)::int AS n FROM "ListingObservation"`);
    expect(lo.rows[0].n).toBe(7);
  });

  it('annonce active : prix initial = première observation, courant = dernière', async () => {
    expect(await tracked('100')).toMatchObject({
      statut: 'ACTIVE',
      prixInitialCents: 3000,
      prixCourantCents: 2500,
      echecsConsecutifs: 0,
      soldAt: null,
      url: 'https://www.vinted.fr/items/100-x',
    });
    const t = await tracked('100');
    expect(t.premiereVuAt.toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect(t.derniereVuAt.toISOString()).toBe('2026-10-03T08:00:00.000Z');
  });

  it('vente enregistrée : SOLD avec les informations de SoldObservation', async () => {
    const t = await tracked('200');
    expect(t).toMatchObject({ statut: 'SOLD', soldPrixCents: 3900, soldSource: 'sold_status' });
    expect(t.soldAt.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });

  it('vue « sold » sans vente enregistrée : projection SoldObservation créée', async () => {
    expect(await tracked('300')).toMatchObject({ statut: 'SOLD', soldPrixCents: 5000 });
    const so = await client.query(`SELECT * FROM "SoldObservation" WHERE "externalId" = '300'`);
    expect(so.rows).toHaveLength(1);
    expect(so.rows[0]).toMatchObject({ prixVenteCents: 5000, source: 'sold_status' });
  });

  it('disparition sans observation : DISAPPEARED, URL reconstituée', async () => {
    expect(await tracked('400')).toMatchObject({
      statut: 'DISAPPEARED',
      soldSource: 'disappeared',
      url: 'https://www.vinted.fr/items/400',
      prixInitialCents: 1500,
    });
  });

  it('chaque observation et chaque vente pointent vers leur annonce suivie', async () => {
    const orphans = await client.query(`
      SELECT count(*)::int AS n FROM "ListingObservation" lo
      JOIN "TrackedListing" t ON t.id = lo."trackedListingId" WHERE lo.titre <> 'Titre ' || t."externalId"`);
    expect(orphans.rows[0].n).toBe(0);
    const so = await client.query(`
      SELECT count(*)::int AS n FROM "SoldObservation" so
      JOIN "TrackedListing" t ON t.id = so."trackedListingId" WHERE t."externalId" = so."externalId"`);
    expect(so.rows[0].n).toBe(3);
  });

  it('ListingObservation ne porte plus aucun champ d’état courant', async () => {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ListingObservation'`,
    );
    const cols = r.rows.map((x) => x.column_name);
    for (const c of [
      'statut',
      'url',
      'externalId',
      'plateforme',
      'categorie',
      'marque',
      'taille',
    ]) {
      expect(cols).not.toContain(c);
    }
    expect(cols).toContain('trackedListingId');
  });

  it('contraintes : unicité (plateforme, externalId) et cohérence statut ↔ vente', async () => {
    const insert = (ext: string, statut: string, soldAt: string | null) =>
      client.query(
        `INSERT INTO "TrackedListing" (id, "externalId", url, categorie, "prixInitialCents", "prixCourantCents", etat, statut, "premiereVuAt", "derniereVuAt", "derniereVerifAt", "soldAt", "soldPrixCents", "soldSource")
         VALUES (gen_random_uuid(), $1, 'u', 'c', 1, 1, 'BON', $2, now(), now(), now(), $3, $4, $5)`,
        [ext, statut, soldAt, soldAt ? 1 : null, soldAt ? 'sold_status' : null],
      );
    await expect(insert('100', 'ACTIVE', null)).rejects.toThrow(
      /TrackedListing_plateforme_externalId_key/,
    );
    await expect(insert('900', 'SOLD', null)).rejects.toThrow(/vente_coherente/);
    await expect(insert('901', 'ACTIVE', '2026-10-01T00:00:00Z')).rejects.toThrow(
      /vente_coherente/,
    );
  });

  it('rollback : schéma init restauré à l’identique et données d’origine reconstituées', async () => {
    await apply(client, TRACKED_DOWN);
    expect(await schemaFingerprint(client)).toEqual(initFingerprint);

    const lo = await client.query(
      `SELECT id, "externalId", url, categorie, marque, taille, statut, "prixCents" FROM "ListingObservation" ORDER BY id`,
    );
    expect(lo.rows).toEqual([
      {
        id: 'a1',
        externalId: '100',
        url: 'https://www.vinted.fr/items/100-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'active',
        prixCents: 3000,
      },
      {
        id: 'a2',
        externalId: '100',
        url: 'https://www.vinted.fr/items/100-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'active',
        prixCents: 2800,
      },
      {
        id: 'a3',
        externalId: '100',
        url: 'https://www.vinted.fr/items/100-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'active',
        prixCents: 2500,
      },
      {
        id: 'b1',
        externalId: '200',
        url: 'https://www.vinted.fr/items/200-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'active',
        prixCents: 4000,
      },
      {
        id: 'b2',
        externalId: '200',
        url: 'https://www.vinted.fr/items/200-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'sold',
        prixCents: 3900,
      },
      {
        id: 'c1',
        externalId: '300',
        url: 'https://www.vinted.fr/items/300-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'active',
        prixCents: 5000,
      },
      {
        id: 'c2',
        externalId: '300',
        url: 'https://www.vinted.fr/items/300-x',
        categorie: 'Baskets',
        marque: 'Nike',
        taille: '42',
        statut: 'sold',
        prixCents: 5000,
      },
    ]);
    const so = await client.query(
      `SELECT id, "externalId", source FROM "SoldObservation" WHERE id IN ('sb', 'sd') ORDER BY id`,
    );
    expect(so.rows).toEqual([
      { id: 'sb', externalId: '200', source: 'sold_status' },
      { id: 'sd', externalId: '400', source: 'disappeared' },
    ]);
  });

  it('après rollback, la migration se réapplique sans erreur', async () => {
    await apply(client, TRACKED);
    const r = await client.query(`SELECT count(*)::int AS n FROM "TrackedListing"`);
    expect(r.rows[0].n).toBe(4);
  });
});

describe.skipIf(!DATABASE_URL)('migration TrackedListing.subcategory — base existante', () => {
  let client: pg.Client;
  let avant: string[];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    ({ client } = await freshDb());
    await apply(client, INIT);
    await seedExisting(client);
    await apply(client, TRACKED);
    await apply(client, SEED_RUN);
    avant = await schemaFingerprint(client);
    await apply(client, SUBCAT);
  });
  afterAll(async () => {
    await client?.end();
  });

  const sub = async (ext: string) =>
    (
      await client.query(
        `SELECT "subcategoryId", "subcategoryLabel" FROM "TrackedListing" WHERE "externalId" = $1`,
        [ext],
      )
    ).rows[0];
  const setSub = (ext: string, id: number | null, label: string | null) =>
    client.query(
      `UPDATE "TrackedListing" SET "subcategoryId" = $2, "subcategoryLabel" = $3 WHERE "externalId" = $1`,
      [ext, id, label],
    );

  it('colonnes nullables ajoutées, annonces existantes intactes et à NULL', async () => {
    const r = await client.query(`SELECT count(*)::int AS n FROM "TrackedListing"`);
    expect(r.rows[0].n).toBe(4);
    expect(await sub('100')).toEqual({ subcategoryId: null, subcategoryLabel: null });
    const fp = await schemaFingerprint(client);
    expect(fp).toContain('TrackedListing.subcategoryId:int4:YES:');
    expect(fp).toContain('TrackedListing.subcategoryLabel:text:YES:');
  });

  it('écriture unique : NULL → valeur accepté, valeur identique accepté, autre valeur refusé', async () => {
    await setSub('100', 1811, 'Pulls à col roulé');
    expect(await sub('100')).toEqual({
      subcategoryId: 1811,
      subcategoryLabel: 'Pulls à col roulé',
    });
    await expect(setSub('100', 1811, 'Pulls à col roulé')).resolves.toBeDefined();
    await expect(setSub('100', 1812, 'Pulls à col roulé')).rejects.toThrow(/immuables/);
    await expect(setSub('100', 1811, 'Autre')).rejects.toThrow(/immuables/);
    await expect(setSub('100', null, null)).rejects.toThrow(/immuables/);
    // Les autres colonnes restent modifiables.
    await client.query(
      `UPDATE "TrackedListing" SET "prixCourantCents" = 2400 WHERE "externalId" = '100'`,
    );
    expect(await sub('100')).toEqual({
      subcategoryId: 1811,
      subcategoryLabel: 'Pulls à col roulé',
    });
  });

  it('rollback : schéma précédent restauré à l’identique, annonces conservées, réapplicable', async () => {
    await apply(client, SUBCAT_DOWN);
    expect(await schemaFingerprint(client)).toEqual(avant);
    const r = await client.query(
      `SELECT "externalId", "prixCourantCents" FROM "TrackedListing" ORDER BY 1`,
    );
    expect(r.rows.map((x) => x.externalId)).toEqual(['100', '200', '300', '400']);
    expect(r.rows[0].prixCourantCents).toBe(2400);
    await apply(client, SUBCAT);
    expect(await sub('100')).toEqual({ subcategoryId: null, subcategoryLabel: null });
  });
});

describe.skipIf(!DATABASE_URL)('migration BrandAlias', () => {
  let client: pg.Client;
  let avant: string[];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    ({ client } = await freshDb());
    for (const m of [INIT, TRACKED, SEED_RUN, SUBCAT]) await apply(client, m);
    avant = await schemaFingerprint(client);
    await apply(client, ALIAS);
  });
  afterAll(async () => {
    await client?.end();
  });

  it('alias validés et datés, ambigus absents', async () => {
    const r = await client.query(
      `SELECT count(*)::int AS n, bool_and(valide) AS v, bool_and("dateValidation" IS NOT NULL) AS d FROM "BrandAlias"`,
    );
    expect(r.rows[0]).toEqual({ n: 29, v: true, d: true });
    const amb = await client.query(
      `SELECT alias FROM "BrandAlias" WHERE lower(alias) IN ('nb', 'ami', 'polo', 'adidas originals')`,
    );
    expect(amb.rows).toEqual([]);
  });

  it('un alias validé sans date est refusé', async () => {
    await expect(
      client.query(`INSERT INTO "BrandAlias" (alias, marque, valide) VALUES ('X', 'Y', true)`),
    ).rejects.toThrow(/validation_datee/);
  });

  it('rollback : schéma précédent restauré, migration réapplicable', async () => {
    await apply(client, ALIAS_DOWN);
    expect(await schemaFingerprint(client)).toEqual(avant);
    await apply(client, ALIAS);
    const r = await client.query(`SELECT count(*)::int AS n FROM "BrandAlias"`);
    expect(r.rows[0].n).toBe(29);
  });
});

describe.skipIf(!DATABASE_URL)('migration SubcategoryToParent + catalogIdRecherche', () => {
  let client: pg.Client;
  let avant: string[];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    ({ client } = await freshDb());
    await apply(client, INIT);
    await seedExisting(client);
    for (const m of [TRACKED, SEED_RUN, SUBCAT, ALIAS]) await apply(client, m);
    avant = await schemaFingerprint(client);
    await apply(client, S2P);
  });
  afterAll(async () => {
    await client?.end();
  });

  const setCat = (ext: string, id: number | null) =>
    client.query(`UPDATE "TrackedListing" SET "catalogIdRecherche" = $2 WHERE "externalId" = $1`, [
      ext,
      id,
    ]);

  it('annonces existantes conservées, catalogIdRecherche à NULL', async () => {
    const r = await client.query(
      `SELECT "externalId", "catalogIdRecherche" FROM "TrackedListing" ORDER BY 1`,
    );
    expect(r.rows).toEqual(
      ['100', '200', '300', '400'].map((externalId) => ({ externalId, catalogIdRecherche: null })),
    );
  });

  it('catalogIdRecherche : écriture unique', async () => {
    await setCat('100', 13);
    await expect(setCat('100', 13)).resolves.toBeDefined();
    await expect(setCat('100', 79)).rejects.toThrow(/immuable/);
    await expect(setCat('100', null)).rejects.toThrow(/immuable/);
  });

  it('SubcategoryToParent : une ligne par sous-catégorie, verifie à false par défaut', async () => {
    await client.query(
      `INSERT INTO "SubcategoryToParent" ("subcategoryId", "parentId", libelle) VALUES (1811, 13, 'Pulls à col roulé')`,
    );
    const r = await client.query(`SELECT * FROM "SubcategoryToParent"`);
    expect(r.rows).toEqual([
      { subcategoryId: 1811, parentId: 13, libelle: 'Pulls à col roulé', verifie: false },
    ]);
    await expect(
      client.query(
        `INSERT INTO "SubcategoryToParent" ("subcategoryId", "parentId", libelle) VALUES (1811, 79, 'x')`,
      ),
    ).rejects.toThrow(/SubcategoryToParent_pkey/);
  });

  it('rollback : schéma précédent restauré, annonces conservées, réapplicable', async () => {
    await apply(client, S2P_DOWN);
    expect(await schemaFingerprint(client)).toEqual(avant);
    const r = await client.query(`SELECT count(*)::int AS n FROM "TrackedListing"`);
    expect(r.rows[0].n).toBe(4);
    await apply(client, S2P);
  });
});

describe.skipIf(!DATABASE_URL)('migration BrandAlias — sous-gammes du 2026-11-04', () => {
  let client: pg.Client;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    ({ client } = await freshDb());
    for (const m of [INIT, TRACKED, SEED_RUN, SUBCAT, ALIAS, S2P, ALIAS2]) await apply(client, m);
  });
  afterAll(async () => {
    await client?.end();
  });

  it('5 alias ajoutés et validés ; Jordan et Yeezy absents', async () => {
    const r = await client.query(
      `SELECT alias, marque FROM "BrandAlias" WHERE "dateValidation" = '2026-11-04T00:00:00Z' ORDER BY alias`,
    );
    expect(r.rows).toEqual([
      { alias: 'Adidas Equipment', marque: 'Adidas' },
      { alias: 'Adidas Terrex', marque: 'Adidas' },
      { alias: 'Nike Air', marque: 'Nike' },
      { alias: 'Nike x Nocta', marque: 'Nike' },
      { alias: 'Nike x Off-White', marque: 'Nike' },
    ]);
    const exclus = await client.query(
      `SELECT alias FROM "BrandAlias" WHERE lower(alias) IN ('jordan', 'yeezy', 'adidas originals')`,
    );
    expect(exclus.rows).toEqual([]);
  });

  it('rollback : retour aux 29 alias, réapplicable', async () => {
    await apply(client, ALIAS2_DOWN);
    expect((await client.query(`SELECT count(*)::int AS n FROM "BrandAlias"`)).rows[0].n).toBe(29);
    await apply(client, ALIAS2);
    expect((await client.query(`SELECT count(*)::int AS n FROM "BrandAlias"`)).rows[0].n).toBe(34);
  });
});
