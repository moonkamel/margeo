-- Alias de marques (doc 2b, section 7). Un alias rattache le texte d'une annonce à une marque
-- canonique de cellule. Seuls les alias `valide = true` sont utilisés ; le seed refuse de crawler
-- une cellule dont la marque a au moins un alias non validé.
-- Non rattachés volontairement (ambigus ou sous-marques) : NB, AMI, Polo, Adidas Originals.

-- CreateTable
CREATE TABLE "BrandAlias" (
    "alias" TEXT NOT NULL,
    "marque" TEXT NOT NULL,
    "valide" BOOLEAN NOT NULL DEFAULT false,
    "dateValidation" TIMESTAMPTZ(3),

    CONSTRAINT "BrandAlias_pkey" PRIMARY KEY ("alias")
);

-- CreateIndex
CREATE INDEX "BrandAlias_marque_idx" ON "BrandAlias"("marque");

-- Un alias validé porte sa date de validation.
ALTER TABLE "BrandAlias" ADD CONSTRAINT "BrandAlias_validation_datee_check"
    CHECK (NOT "valide" OR "dateValidation" IS NOT NULL);

-- Alias validés le 2026-11-03 (section 7).
INSERT INTO "BrandAlias" ("alias", "marque", "valide", "dateValidation") VALUES
    ('NewBalance', 'New Balance', true, '2026-11-03T00:00:00Z'),
    ('New-Balance', 'New Balance', true, '2026-11-03T00:00:00Z'),
    ('New balance', 'New Balance', true, '2026-11-03T00:00:00Z'),
    ('new balance', 'New Balance', true, '2026-11-03T00:00:00Z'),
    ('NIKE', 'Nike', true, '2026-11-03T00:00:00Z'),
    ('nike', 'Nike', true, '2026-11-03T00:00:00Z'),
    ('ADIDAS', 'Adidas', true, '2026-11-03T00:00:00Z'),
    ('adidas', 'Adidas', true, '2026-11-03T00:00:00Z'),
    ('Sezane', 'Sézane', true, '2026-11-03T00:00:00Z'),
    ('SEZANE', 'Sézane', true, '2026-11-03T00:00:00Z'),
    ('Sézane Paris', 'Sézane', true, '2026-11-03T00:00:00Z'),
    ('Ami Paris', 'AMI Paris', true, '2026-11-03T00:00:00Z'),
    ('ami paris', 'AMI Paris', true, '2026-11-03T00:00:00Z'),
    ('SANDRO', 'Sandro', true, '2026-11-03T00:00:00Z'),
    ('sandro paris', 'Sandro', true, '2026-11-03T00:00:00Z'),
    ('MAJE', 'Maje', true, '2026-11-03T00:00:00Z'),
    ('maje paris', 'Maje', true, '2026-11-03T00:00:00Z'),
    ('RALPH LAUREN', 'Ralph Lauren', true, '2026-11-03T00:00:00Z'),
    ('Polo Ralph Lauren', 'Ralph Lauren', true, '2026-11-03T00:00:00Z'),
    ('apple', 'Apple', true, '2026-11-03T00:00:00Z'),
    ('APPLE', 'Apple', true, '2026-11-03T00:00:00Z'),
    ('SONY', 'Sony', true, '2026-11-03T00:00:00Z'),
    ('sony', 'Sony', true, '2026-11-03T00:00:00Z'),
    ('BOSE', 'Bose', true, '2026-11-03T00:00:00Z'),
    ('bose', 'Bose', true, '2026-11-03T00:00:00Z'),
    ('JBL', 'JBL', true, '2026-11-03T00:00:00Z'),
    ('jbl', 'JBL', true, '2026-11-03T00:00:00Z'),
    ('SAMSUNG', 'Samsung', true, '2026-11-03T00:00:00Z'),
    ('samsung', 'Samsung', true, '2026-11-03T00:00:00Z');
