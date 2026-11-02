-- Rattachement par catalogue (décision du 2026-11-04, point 3).
--  1. TrackedListing.catalogIdRecherche : catalogue PARENT de la recherche qui a découvert
--     l'annonce (ex. 13, 79). Avec la marque canonique, c'est la clé de cellule ; le libellé
--     n'est jamais utilisé pour rattacher. Écriture unique, comme subcategoryId.
--  2. SubcategoryToParent : correspondance sous-catégorie → catalogue parent, remplie au fil
--     des observations, vérifiée manuellement à J+14. Permet de détecter un élargissement
--     silencieux d'une recherche vers des sous-catégories hors du parent demandé.

-- AlterTable
ALTER TABLE "TrackedListing" ADD COLUMN "catalogIdRecherche" INTEGER;

-- CreateIndex
CREATE INDEX "TrackedListing_catalogIdRecherche_marque_statut_idx" ON "TrackedListing"("catalogIdRecherche", "marque", "statut");

CREATE FUNCTION "tracked_listing_catalogue_immuable"() RETURNS trigger AS $$
BEGIN
    IF OLD."catalogIdRecherche" IS NOT NULL AND NEW."catalogIdRecherche" IS DISTINCT FROM OLD."catalogIdRecherche" THEN
        RAISE EXCEPTION 'TrackedListing %: catalogIdRecherche est immuable une fois renseigné', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TrackedListing_catalogue_immuable"
    BEFORE UPDATE OF "catalogIdRecherche" ON "TrackedListing"
    FOR EACH ROW EXECUTE FUNCTION "tracked_listing_catalogue_immuable"();

-- CreateTable
CREATE TABLE "SubcategoryToParent" (
    "subcategoryId" INTEGER NOT NULL,
    "parentId" INTEGER NOT NULL,
    "libelle" TEXT NOT NULL,
    "verifie" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SubcategoryToParent_pkey" PRIMARY KEY ("subcategoryId")
);

-- CreateIndex
CREATE INDEX "SubcategoryToParent_parentId_idx" ON "SubcategoryToParent"("parentId");
