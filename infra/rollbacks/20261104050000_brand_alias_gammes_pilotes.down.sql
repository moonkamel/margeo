-- Rollback de 20261104050000_brand_alias_gammes_pilotes : retire les 4 alias ajoutés.
DELETE FROM "BrandAlias" WHERE "alias" IN ('Nike SB', 'Air Force', 'adidas Stan Smith', 'adidas x Oamc');
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104050000_brand_alias_gammes_pilotes';
    END IF;
END $$;
