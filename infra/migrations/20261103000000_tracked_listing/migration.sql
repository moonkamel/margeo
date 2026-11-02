-- Migration : TrackedListing (état courant) + ListingObservation en journal append-only
-- + SoldObservation en projection de TrackedListing.
--
-- NON DESTRUCTIVE : les données existantes de ListingObservation et SoldObservation sont
-- reprises dans TrackedListing AVANT toute suppression de colonne.
-- Rollback : infra/rollbacks/20261103000000_tracked_listing.down.sql

-- 1. Type et table d'état courant ------------------------------------------------------------
CREATE TYPE "TrackedListingStatut" AS ENUM ('ACTIVE', 'SOLD', 'DISAPPEARED', 'CLOSED');

CREATE TABLE "TrackedListing" (
    "id" UUID NOT NULL,
    "plateforme" "Plateforme" NOT NULL DEFAULT 'VINTED',
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "marque" TEXT,
    "taille" TEXT,
    "prixInitialCents" INTEGER NOT NULL,
    "prixCourantCents" INTEGER NOT NULL,
    "etat" "Etat" NOT NULL,
    "statut" "TrackedListingStatut" NOT NULL DEFAULT 'ACTIVE',
    "premiereVuAt" TIMESTAMPTZ(3) NOT NULL,
    "derniereVuAt" TIMESTAMPTZ(3) NOT NULL,
    "derniereVerifAt" TIMESTAMPTZ(3) NOT NULL,
    "echecsConsecutifs" INTEGER NOT NULL DEFAULT 0,
    "soldAt" TIMESTAMPTZ(3),
    "soldPrixCents" INTEGER,
    "soldSource" "SoldSource",

    CONSTRAINT "TrackedListing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackedListing_statut_derniereVerifAt_idx" ON "TrackedListing"("statut", "derniereVerifAt");
CREATE UNIQUE INDEX "TrackedListing_plateforme_externalId_key" ON "TrackedListing"("plateforme", "externalId");

-- 2. Reprise des annonces déjà observées -----------------------------------------------------
-- Les colonnes TIMESTAMP(3) existantes sont en UTC (convention Prisma) : AT TIME ZONE 'UTC'.
INSERT INTO "TrackedListing" (
    "id", "plateforme", "externalId", "url", "categorie", "marque", "taille",
    "prixInitialCents", "prixCourantCents", "etat", "statut",
    "premiereVuAt", "derniereVuAt", "derniereVerifAt", "echecsConsecutifs",
    "soldAt", "soldPrixCents", "soldSource"
)
SELECT
    gen_random_uuid(), agg."plateforme", agg."externalId", last."url", last."categorie",
    last."marque", last."taille", first."prixCents", last."prixCents", last."etat",
    CASE WHEN last."statut" = 'sold' THEN 'SOLD' ELSE 'ACTIVE' END::"TrackedListingStatut",
    agg."premiere" AT TIME ZONE 'UTC', agg."derniere" AT TIME ZONE 'UTC', agg."derniere" AT TIME ZONE 'UTC', 0,
    CASE WHEN last."statut" = 'sold' THEN last."observedAt" AT TIME ZONE 'UTC' END,
    CASE WHEN last."statut" = 'sold' THEN last."prixCents" END,
    CASE WHEN last."statut" = 'sold' THEN 'sold_status'::"SoldSource" END
FROM (
    SELECT "plateforme", "externalId", MIN("observedAt") AS "premiere", MAX("observedAt") AS "derniere"
    FROM "ListingObservation"
    GROUP BY "plateforme", "externalId"
) agg
JOIN LATERAL (
    SELECT * FROM "ListingObservation" lo
    WHERE lo."plateforme" = agg."plateforme" AND lo."externalId" = agg."externalId"
    ORDER BY lo."observedAt" DESC, lo."id" DESC LIMIT 1
) last ON TRUE
JOIN LATERAL (
    SELECT * FROM "ListingObservation" lo
    WHERE lo."plateforme" = agg."plateforme" AND lo."externalId" = agg."externalId"
    ORDER BY lo."observedAt" ASC, lo."id" ASC LIMIT 1
) first ON TRUE;

-- 3. Les ventes existantes font foi pour l'état vendu / disparu ------------------------------
UPDATE "TrackedListing" t SET
    "statut" = CASE WHEN so."source" = 'sold_status' THEN 'SOLD' ELSE 'DISAPPEARED' END::"TrackedListingStatut",
    "soldAt" = so."soldAt" AT TIME ZONE 'UTC',
    "soldPrixCents" = so."prixVenteCents",
    "soldSource" = so."source"
FROM "SoldObservation" so
WHERE so."plateforme" = t."plateforme" AND so."externalId" = t."externalId";

-- Ventes sans aucune observation d'annonce : on crée l'annonce suivie correspondante.
INSERT INTO "TrackedListing" (
    "id", "plateforme", "externalId", "url", "categorie", "marque", "taille",
    "prixInitialCents", "prixCourantCents", "etat", "statut",
    "premiereVuAt", "derniereVuAt", "derniereVerifAt", "echecsConsecutifs",
    "soldAt", "soldPrixCents", "soldSource"
)
SELECT
    gen_random_uuid(), so."plateforme", so."externalId",
    'https://www.vinted.fr/items/' || so."externalId",
    so."categorie", so."marque", so."taille", so."prixVenteCents", so."prixVenteCents", so."etat",
    CASE WHEN so."source" = 'sold_status' THEN 'SOLD' ELSE 'DISAPPEARED' END::"TrackedListingStatut",
    COALESCE(so."listedAt", so."soldAt") AT TIME ZONE 'UTC', so."soldAt" AT TIME ZONE 'UTC', so."soldAt" AT TIME ZONE 'UTC', 0,
    so."soldAt" AT TIME ZONE 'UTC', so."prixVenteCents", so."source"
FROM "SoldObservation" so
WHERE NOT EXISTS (
    SELECT 1 FROM "TrackedListing" t WHERE t."plateforme" = so."plateforme" AND t."externalId" = so."externalId"
);

-- Annonces vues « sold » sans vente enregistrée : on écrit la projection manquante.
INSERT INTO "SoldObservation" (
    "id", "externalId", "plateforme", "prixVenteCents", "etat", "categorie", "marque", "taille",
    "listedAt", "soldAt", "source", "createdAt"
)
SELECT
    gen_random_uuid()::text, t."externalId", t."plateforme", t."soldPrixCents", t."etat",
    t."categorie", t."marque", t."taille",
    t."premiereVuAt" AT TIME ZONE 'UTC', t."soldAt" AT TIME ZONE 'UTC', t."soldSource", CURRENT_TIMESTAMP
FROM "TrackedListing" t
WHERE t."statut" IN ('SOLD', 'DISAPPEARED')
  AND NOT EXISTS (
    SELECT 1 FROM "SoldObservation" so WHERE so."plateforme" = t."plateforme" AND so."externalId" = t."externalId"
  );

-- Invariant : statut vendu/disparu <=> informations de vente renseignées.
ALTER TABLE "TrackedListing" ADD CONSTRAINT "TrackedListing_vente_coherente_check" CHECK (
    ("statut" IN ('SOLD', 'DISAPPEARED')) =
    ("soldAt" IS NOT NULL AND "soldPrixCents" IS NOT NULL AND "soldSource" IS NOT NULL)
);

-- 4. ListingObservation devient un journal rattaché à TrackedListing ------------------------
ALTER TABLE "ListingObservation" ADD COLUMN "trackedListingId" UUID;

UPDATE "ListingObservation" lo SET "trackedListingId" = t."id"
FROM "TrackedListing" t
WHERE t."plateforme" = lo."plateforme" AND t."externalId" = lo."externalId";

ALTER TABLE "ListingObservation" ALTER COLUMN "trackedListingId" SET NOT NULL;

DROP INDEX "ListingObservation_externalId_plateforme_idx";
DROP INDEX "ListingObservation_categorie_marque_observedAt_idx";

-- Champs d'état courant / d'identité retirés : ils vivent désormais dans TrackedListing.
ALTER TABLE "ListingObservation"
    DROP COLUMN "categorie",
    DROP COLUMN "externalId",
    DROP COLUMN "marque",
    DROP COLUMN "plateforme",
    DROP COLUMN "statut",
    DROP COLUMN "taille",
    DROP COLUMN "url";

CREATE INDEX "ListingObservation_trackedListingId_observedAt_idx" ON "ListingObservation"("trackedListingId", "observedAt");

ALTER TABLE "ListingObservation" ADD CONSTRAINT "ListingObservation_trackedListingId_fkey"
    FOREIGN KEY ("trackedListingId") REFERENCES "TrackedListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TYPE "ListingStatut";

-- 5. SoldObservation devient une projection de TrackedListing --------------------------------
ALTER TABLE "SoldObservation" ADD COLUMN "trackedListingId" UUID;

UPDATE "SoldObservation" so SET "trackedListingId" = t."id"
FROM "TrackedListing" t
WHERE t."plateforme" = so."plateforme" AND t."externalId" = so."externalId";

ALTER TABLE "SoldObservation" ALTER COLUMN "trackedListingId" SET NOT NULL;

CREATE UNIQUE INDEX "SoldObservation_trackedListingId_key" ON "SoldObservation"("trackedListingId");

ALTER TABLE "SoldObservation" ADD CONSTRAINT "SoldObservation_trackedListingId_fkey"
    FOREIGN KEY ("trackedListingId") REFERENCES "TrackedListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
