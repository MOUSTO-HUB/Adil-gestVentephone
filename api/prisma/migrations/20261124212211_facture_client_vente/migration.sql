-- AlterTable
ALTER TABLE "Vente" ADD COLUMN     "adresseClient" TEXT,
ADD COLUMN     "contactClient" TEXT,
ADD COLUMN     "factureEmise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nomClient" TEXT;
