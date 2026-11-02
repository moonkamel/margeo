import { defineConfig } from 'prisma/config';

/**
 * Les migrations vivent dans infra/migrations (arborescence cible du projet),
 * le schéma reste à côté du client généré dans packages/db.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: '../../infra/migrations' },
  datasource: {
    // Valeur de repli : `prisma generate` n'a pas besoin d'une base joignable (CI).
    url: process.env.DATABASE_URL ?? 'postgresql://margeo:margeo@localhost:5432/margeo',
  },
});
