-- Rollback de 20261104010000_brand_alias (table additive, aucune dépendance).
DROP TABLE "BrandAlias";
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104010000_brand_alias';
    END IF;
END $$;
