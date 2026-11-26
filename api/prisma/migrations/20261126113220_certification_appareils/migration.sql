-- CreateEnum
CREATE TYPE "TitulaireCertificat" AS ENUM ('UTILISATEUR', 'CONCEPTEUR');

-- AlterTable
ALTER TABLE "Appareil" ADD COLUMN     "certificatId" TEXT;

-- CreateTable
CREATE TABLE "CertificatAppareil" (
    "id" TEXT NOT NULL,
    "titulaire" "TitulaireCertificat" NOT NULL,
    "utilisateurId" TEXT,
    "concepteurId" TEXT,
    "commerceId" TEXT,
    "empreinte" TEXT NOT NULL,
    "clePublique" JSONB NOT NULL,
    "nom" TEXT NOT NULL,
    "plateforme" TEXT NOT NULL,
    "origine" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dernierUsage" TIMESTAMP(3),
    "revoqueLe" TIMESTAMP(3),
    "revoquePar" TEXT,

    CONSTRAINT "CertificatAppareil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeAppareil" (
    "id" TEXT NOT NULL,
    "titulaire" "TitulaireCertificat" NOT NULL,
    "utilisateurId" TEXT,
    "concepteurId" TEXT,
    "commerceId" TEXT,
    "codeHash" TEXT NOT NULL,
    "remplacer" BOOLEAN NOT NULL DEFAULT true,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "utiliseLe" TIMESTAMP(3),
    "annuleLe" TIMESTAMP(3),
    "creePar" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeAppareil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificatAppareil_utilisateurId_idx" ON "CertificatAppareil"("utilisateurId");

-- CreateIndex
CREATE INDEX "CertificatAppareil_concepteurId_idx" ON "CertificatAppareil"("concepteurId");

-- CreateIndex
CREATE INDEX "CertificatAppareil_commerceId_idx" ON "CertificatAppareil"("commerceId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificatAppareil_empreinte_utilisateurId_key" ON "CertificatAppareil"("empreinte", "utilisateurId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificatAppareil_empreinte_concepteurId_key" ON "CertificatAppareil"("empreinte", "concepteurId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeAppareil_codeHash_key" ON "CodeAppareil"("codeHash");

-- CreateIndex
CREATE INDEX "CodeAppareil_utilisateurId_idx" ON "CodeAppareil"("utilisateurId");

-- CreateIndex
CREATE INDEX "CodeAppareil_concepteurId_idx" ON "CodeAppareil"("concepteurId");

-- CreateIndex
CREATE INDEX "CodeAppareil_commerceId_idx" ON "CodeAppareil"("commerceId");
