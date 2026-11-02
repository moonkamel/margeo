-- Rollback de 20261103010000_seed_run (table additive, aucune donnée métier dépendante).
DROP TABLE "SeedRun";
DROP TYPE "SeedRunStatut";
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103010000_seed_run';
    END IF;
END $$;
