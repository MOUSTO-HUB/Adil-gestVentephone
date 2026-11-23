-- AlterTable
ALTER TABLE "Concepteur" ADD COLUMN     "creeParId" TEXT,
ADD COLUMN     "doitChangerMotDePasse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supprimeLe" TIMESTAMP(3),
ADD COLUMN     "totpActif" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpDernierPas" INTEGER,
ADD COLUMN     "totpSecret" TEXT;
