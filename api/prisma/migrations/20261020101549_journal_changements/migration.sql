-- CreateTable
CREATE TABLE "Changement" (
    "seq" BIGSERIAL NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "donnees" JSONB,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Changement_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "Changement_commerceId_seq_idx" ON "Changement"("commerceId", "seq");

-- AddForeignKey
ALTER TABLE "Changement" ADD CONSTRAINT "Changement_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
