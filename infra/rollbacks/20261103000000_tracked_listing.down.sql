-- Rollback de 20261103000000_tracked_listing.
-- Restaure le schéma d'origine de ListingObservation / SoldObservation à partir de
-- TrackedListing, puis supprime TrackedListing. À exécuter dans une transaction :
--   psql "$DATABASE_URL" --single-transaction -f infra/rollbacks/20261103000000_tracked_listing.down.sql
-- Limite connue : les projections SoldObservation créées par la migration (annonces vues
-- « sold » sans vente enregistrée) sont conservées ; ce sont des ventes valides.

CREATE TYPE "ListingStatut" AS ENUM ('active', 'sold');

-- 1. ListingObservation : colonnes d'identité et de statut restaurées ------------------------
ALTER TABLE "ListingObservation" DROP CONSTRAINT "ListingObservation_trackedListingId_fkey";
DROP INDEX "ListingObservation_trackedListingId_observedAt_idx";

ALTER TABLE "ListingObservation"
    ADD COLUMN "externalId" TEXT,
    ADD COLUMN "plateforme" "Plateforme" DEFAULT 'VINTED',
    ADD COLUMN "url" TEXT,
    ADD COLUMN "categorie" TEXT,
    ADD COLUMN "marque" TEXT,
    ADD COLUMN "taille" TEXT,
    ADD COLUMN "statut" "ListingStatut";

-- Une observation est « sold » si l'annonce est vendue (statut explicite) et que
-- l'observation est postérieure ou égale à la date de vente.
UPDATE "ListingObservation" lo SET
    "externalId" = t."externalId",
    "plateforme" = t."plateforme",
    "url" = t."url",
    "categorie" = t."categorie",
    "marque" = t."marque",
    "taille" = t."taille",
    "statut" = CASE
        WHEN t."statut" = 'SOLD' AND lo."observedAt" >= (t."soldAt" AT TIME ZONE 'UTC') THEN 'sold'
        ELSE 'active'
    END::"ListingStatut"
FROM "TrackedListing" t
WHERE t."id" = lo."trackedListingId";

ALTER TABLE "ListingObservation"
    ALTER COLUMN "externalId" SET NOT NULL,
    ALTER COLUMN "plateforme" SET NOT NULL,
    ALTER COLUMN "url" SET NOT NULL,
    ALTER COLUMN "categorie" SET NOT NULL,
    ALTER COLUMN "statut" SET NOT NULL,
    DROP COLUMN "trackedListingId";

CREATE INDEX "ListingObservation_externalId_plateforme_idx" ON "ListingObservation"("externalId", "plateforme");
CREATE INDEX "ListingObservation_categorie_marque_observedAt_idx" ON "ListingObservation"("categorie", "marque", "observedAt");

-- 2. SoldObservation : retrait du lien de projection -----------------------------------------
ALTER TABLE "SoldObservation" DROP CONSTRAINT "SoldObservation_trackedListingId_fkey";
DROP INDEX "SoldObservation_trackedListingId_key";
ALTER TABLE "SoldObservation" DROP COLUMN "trackedListingId";

-- 3. Suppression de l'état courant -----------------------------------------------------------
DROP TABLE "TrackedListing";
DROP TYPE "TrackedListingStatut";

-- 4. Historique Prisma : la migration pourra être réappliquée par `prisma migrate deploy`.
DO $$
BEGIN
    IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
        DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103000000_tracked_listing';
    END IF;
END $$;
