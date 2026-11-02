-- Rollback de 20261104020000_subcategory_to_parent (additif).
-- Perte assumée : la correspondance sous-catégorie → parent et le catalogue de recherche.
DROP TABLE "SubcategoryToParent";
DROP TRIGGER "TrackedListing_catalogue_immuable" ON "TrackedListing";
DROP FUNCTION "tracked_listing_catalogue_immuable"();
DROP INDEX "TrackedListing_catalogIdRecherche_marque_statut_idx";
ALTER TABLE "TrackedListing" DROP COLUMN "catalogIdRecherche";
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261104020000_subcategory_to_parent';
    END IF;
END $$;
