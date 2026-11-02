-- Rollback de 20261104040000_brand_alias_sous_gammes : retire les 5 alias ajoutés.
DELETE FROM "BrandAlias" WHERE "alias" IN
    ('Nike Air', 'Nike x Nocta', 'Nike x Off-White', 'Adidas Equipment', 'Adidas Terrex');
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104040000_brand_alias_sous_gammes';
    END IF;
END $$;
