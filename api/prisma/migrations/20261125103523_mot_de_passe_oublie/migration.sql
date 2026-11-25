-- CreateEnum
CREATE TYPE "StatutDemandeMotDePasse" AS ENUM ('EN_ATTENTE', 'TRAITEE', 'IGNOREE');

-- CreateTable
CREATE TABLE "DemandeMotDePasse" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "contact" TEXT,
    "message" TEXT,
    "statut" "StatutDemandeMotDePasse" NOT NULL DEFAULT 'EN_ATTENTE',
    "ip" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteLe" TIMESTAMP(3),
    "traiteParId" TEXT,

    CONSTRAINT "DemandeMotDePasse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReglagePlateforme" (
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReglagePlateforme_pkey" PRIMARY KEY ("cle")
);

-- CreateIndex
CREATE INDEX "DemandeMotDePasse_statut_creeLe_idx" ON "DemandeMotDePasse"("statut", "creeLe");

-- CreateIndex
CREATE INDEX "DemandeMotDePasse_utilisateurId_idx" ON "DemandeMotDePasse"("utilisateurId");
