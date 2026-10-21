-- CreateEnum
CREATE TYPE "StatutCommerce" AS ENUM ('ACTIF', 'SUSPENDU', 'SUPPRIME');

-- AlterTable
ALTER TABLE "Boutique" ADD COLUMN     "supprimeeLe" TIMESTAMP(3),
ADD COLUMN     "verrouillee" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Commerce" ADD COLUMN     "abonnementJusquAu" TIMESTAMP(3),
ADD COLUMN     "motifStatut" TEXT,
ADD COLUMN     "statut" "StatutCommerce" NOT NULL DEFAULT 'ACTIF',
ADD COLUMN     "statutModifieLe" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Concepteur" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "identifiant" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniereConnexion" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Concepteur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Concepteur_identifiant_key" ON "Concepteur"("identifiant");

