-- CreateEnum
CREATE TYPE "EtatRetour" AS ENUM ('INTACT', 'DEFECTUEUX', 'ENDOMMAGE');

-- AlterEnum
ALTER TYPE "DestinationRetour" ADD VALUE 'OCCASION';

-- AlterEnum
ALTER TYPE "MoyenPaiement" ADD VALUE 'AVOIR';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "soldeAvoir" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Commerce" ADD COLUMN     "delaiRetourJours" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "LigneRetour" ADD COLUMN     "prixRevente" BIGINT;

-- AlterTable
ALTER TABLE "Retour" ADD COLUMN     "appareilId" TEXT,
ADD COLUMN     "avoir" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "dateRetour" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "etatAppareil" "EtatRetour" NOT NULL DEFAULT 'INTACT',
ADD COLUMN     "referenceRemboursement" TEXT,
ADD COLUMN     "valeur" BIGINT NOT NULL DEFAULT 0;
