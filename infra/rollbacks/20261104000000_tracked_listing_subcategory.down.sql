-- Rollback de 20261104000000_tracked_listing_subcategory (colonnes additives, nullables).
-- Perte assumée : la sous-catégorie observée des annonces suivies.
DROP TRIGGER "TrackedListing_subcategory_immuable" ON "TrackedListing";
DROP FUNCTION "tracked_listing_subcategory_immuable"();
ALTER TABLE "TrackedListing" DROP COLUMN "subcategoryLabel",
DROP COLUMN "subcategoryId";
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104000000_tracked_listing_subcategory';
    END IF;
END $$;
