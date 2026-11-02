-- Sous-catégorie Vinted d'une annonce suivie (catalogue feuille), décision du 2026-11-04.
-- Le seed crawle des catégories parentes (ex. 13 « Sweats et sweats à capuche », 79 « Sweats et
-- pulls ») : la sous-catégorie permet de raffiner en SQL (« pulls seuls ») sans re-crawl.
-- Renseignée à la première observation, jamais modifiée ensuite (garde-fou ci-dessous).

-- AlterTable
ALTER TABLE "TrackedListing" ADD COLUMN "subcategoryId" INTEGER,
ADD COLUMN "subcategoryLabel" TEXT;

-- Écriture unique : NULL → valeur autorisé, valeur → autre valeur refusé.
CREATE FUNCTION "tracked_listing_subcategory_immuable"() RETURNS trigger AS $$
BEGIN
    IF (OLD."subcategoryId" IS NOT NULL AND NEW."subcategoryId" IS DISTINCT FROM OLD."subcategoryId")
       OR (OLD."subcategoryLabel" IS NOT NULL AND NEW."subcategoryLabel" IS DISTINCT FROM OLD."subcategoryLabel") THEN
        RAISE EXCEPTION 'TrackedListing %: subcategoryId/subcategoryLabel sont immuables une fois renseignés', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TrackedListing_subcategory_immuable"
    BEFORE UPDATE OF "subcategoryId", "subcategoryLabel" ON "TrackedListing"
    FOR EACH ROW EXECUTE FUNCTION "tracked_listing_subcategory_immuable"();
