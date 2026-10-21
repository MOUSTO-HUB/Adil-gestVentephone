-- DropIndex
DROP INDEX "Troc_articleId_key";

-- AlterTable
ALTER TABLE "Commerce" ADD COLUMN     "repriseMaxVendeur" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "Troc" DROP COLUMN "description",
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Troc_boutiqueId_creeLe_idx" ON "Troc"("boutiqueId", "creeLe");

-- CreateIndex
CREATE INDEX "Troc_articleId_idx" ON "Troc"("articleId");

