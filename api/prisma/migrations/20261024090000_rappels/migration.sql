-- CreateEnum
CREATE TYPE "TypePenalite" AS ENUM ('FIXE', 'POURCENTAGE');

-- AlterTable
ALTER TABLE "Commerce" ADD COLUMN     "canalRappels" "CanalMessage" NOT NULL DEFAULT 'SMS',
ADD COLUMN     "penaliteActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "penaliteGrace" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "penaliteType" "TypePenalite" NOT NULL DEFAULT 'FIXE',
ADD COLUMN     "penaliteValeur" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rappelJoursAvant" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "relancesMax" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "Echeance" ADD COLUMN     "nombreRelances" INTEGER NOT NULL DEFAULT 0;

