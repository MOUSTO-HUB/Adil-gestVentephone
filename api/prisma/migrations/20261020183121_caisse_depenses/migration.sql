-- AlterTable
ALTER TABLE "Caisse" ADD COLUMN     "appareilId" TEXT,
ADD COLUMN     "commentaireValidation" TEXT;

-- AlterTable
ALTER TABLE "Depense" ADD COLUMN     "appareilId" TEXT,
ADD COLUMN     "moyen" "MoyenPaiement" NOT NULL DEFAULT 'ESPECES';
