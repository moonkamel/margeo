-- CreateEnum
CREATE TYPE "SeedRunStatut" AS ENUM ('RUNNING', 'COMPLETED', 'PARTIAL', 'BUDGET_STOPPED', 'FAILED');

-- CreateTable
CREATE TABLE "SeedRun" (
    "id" UUID NOT NULL,
    "campagne" TEXT NOT NULL,
    "statut" "SeedRunStatut" NOT NULL DEFAULT 'RUNNING',
    "budgetMaxCents" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "coutSuiviMilliCents" INTEGER NOT NULL DEFAULT 0,
    "coutDecouverteMilliCents" INTEGER NOT NULL DEFAULT 0,
    "resultatsFactures" INTEGER NOT NULL DEFAULT 0,
    "annoncesVerifiees" INTEGER NOT NULL DEFAULT 0,
    "nouvellesAnnonces" INTEGER NOT NULL DEFAULT 0,
    "ventesDetectees" INTEGER NOT NULL DEFAULT 0,
    "disparitions" INTEGER NOT NULL DEFAULT 0,
    "erreurs" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,

    CONSTRAINT "SeedRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeedRun_campagne_startedAt_idx" ON "SeedRun"("campagne", "startedAt");

