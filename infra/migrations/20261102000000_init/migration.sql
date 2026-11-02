-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModeVente" AS ENUM ('PARTICULIER', 'PRO');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "Plateforme" AS ENUM ('VINTED');

-- CreateEnum
CREATE TYPE "Etat" AS ENUM ('NEUF_AVEC_ETIQUETTE', 'NEUF_SANS_ETIQUETTE', 'TRES_BON', 'BON', 'SATISFAISANT');

-- CreateEnum
CREATE TYPE "AnalysisStatut" AS ENUM ('VERT', 'ORANGE', 'ROUGE', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('low', 'high');

-- CreateEnum
CREATE TYPE "SoldSource" AS ENUM ('sold_status', 'disappeared');

-- CreateEnum
CREATE TYPE "ListingStatut" AS ENUM ('active', 'sold');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tauxHoraireCents" INTEGER NOT NULL DEFAULT 1200,
    "seuilMargeCents" INTEGER NOT NULL DEFAULT 500,
    "tempsEstimeMinutes" INTEGER NOT NULL DEFAULT 20,
    "coutEmballageCents" INTEGER NOT NULL DEFAULT 50,
    "modeVente" "ModeVente" NOT NULL DEFAULT 'PARTICULIER',
    "tauxHoraireModifieManuellement" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MagicLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "externalId" TEXT,
    "plateforme" "Plateforme" NOT NULL DEFAULT 'VINTED',
    "listingSnapshot" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "statut" "AnalysisStatut" NOT NULL,
    "margeNetteCents" INTEGER,
    "score" INTEGER,
    "confidence" "Confidence",
    "categorie" TEXT NOT NULL,
    "marque" TEXT,
    "consommeQuota" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingObservation" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "plateforme" "Plateforme" NOT NULL DEFAULT 'VINTED',
    "url" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "marque" TEXT,
    "taille" TEXT,
    "etat" "Etat" NOT NULL,
    "prixCents" INTEGER NOT NULL,
    "favoris" INTEGER NOT NULL,
    "vues" INTEGER NOT NULL,
    "statut" "ListingStatut" NOT NULL,
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoldObservation" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "plateforme" "Plateforme" NOT NULL DEFAULT 'VINTED',
    "prixVenteCents" INTEGER NOT NULL,
    "etat" "Etat" NOT NULL,
    "categorie" TEXT NOT NULL,
    "marque" TEXT,
    "taille" TEXT,
    "listedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3) NOT NULL,
    "source" "SoldSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "seuilMargeCents" INTEGER NOT NULL,
    "derniereExecutionAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "statut" "SubscriptionStatus" NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MagicLinkToken_token_key" ON "MagicLinkToken"("token");

-- CreateIndex
CREATE INDEX "MagicLinkToken_userId_idx" ON "MagicLinkToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "Analysis_userId_createdAt_idx" ON "Analysis"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Analysis_createdAt_categorie_marque_idx" ON "Analysis"("createdAt", "categorie", "marque");

-- CreateIndex
CREATE INDEX "ListingObservation_externalId_plateforme_idx" ON "ListingObservation"("externalId", "plateforme");

-- CreateIndex
CREATE INDEX "ListingObservation_categorie_marque_observedAt_idx" ON "ListingObservation"("categorie", "marque", "observedAt");

-- CreateIndex
CREATE INDEX "SoldObservation_categorie_marque_taille_soldAt_idx" ON "SoldObservation"("categorie", "marque", "taille", "soldAt");

-- CreateIndex
CREATE UNIQUE INDEX "SoldObservation_externalId_plateforme_key" ON "SoldObservation"("externalId", "plateforme");

-- CreateIndex
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");

-- CreateIndex
CREATE INDEX "Alert_active_derniereExecutionAt_idx" ON "Alert"("active", "derniereExecutionAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "MagicLinkToken" ADD CONSTRAINT "MagicLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

