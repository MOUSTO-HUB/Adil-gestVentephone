-- CreateEnum
CREATE TYPE "FormuleAbonnement" AS ENUM ('MENSUELLE', 'ANNUELLE');

-- AlterTable
ALTER TABLE "Commerce" ADD COLUMN     "essaiJusquAu" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaiementAbonnement" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "formule" "FormuleAbonnement" NOT NULL,
    "periodes" INTEGER NOT NULL,
    "montant" BIGINT NOT NULL,
    "moyen" "MoyenPaiement" NOT NULL,
    "reference" TEXT,
    "periodeDu" TIMESTAMP(3) NOT NULL,
    "periodeAu" TIMESTAMP(3) NOT NULL,
    "saisiPar" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaiementAbonnement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaiementAbonnement_commerceId_creeLe_idx" ON "PaiementAbonnement"("commerceId", "creeLe");

-- CreateIndex
CREATE INDEX "PaiementAbonnement_creeLe_idx" ON "PaiementAbonnement"("creeLe");

-- AddForeignKey
ALTER TABLE "PaiementAbonnement" ADD CONSTRAINT "PaiementAbonnement_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

