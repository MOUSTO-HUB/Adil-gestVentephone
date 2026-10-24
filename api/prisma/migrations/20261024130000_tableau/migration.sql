-- CreateTable
CREATE TABLE "RapportArchive" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "frequence" TEXT NOT NULL,
    "du" TIMESTAMP(3) NOT NULL,
    "au" TIMESTAMP(3) NOT NULL,
    "fichierCle" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RapportArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RapportArchive_commerceId_frequence_du_key" ON "RapportArchive"("commerceId", "frequence", "du");

-- CreateIndex
CREATE INDEX "Credit_boutiqueId_statut_idx" ON "Credit"("boutiqueId", "statut");

-- CreateIndex
CREATE INDEX "Encaissement_caisseId_idx" ON "Encaissement"("caisseId");

-- CreateIndex
CREATE INDEX "OperationSync_boutiqueId_recueLe_idx" ON "OperationSync"("boutiqueId", "recueLe");

-- CreateIndex
CREATE INDEX "Retour_boutiqueId_dateRetour_idx" ON "Retour"("boutiqueId", "dateRetour");

-- CreateIndex
CREATE INDEX "Vente_boutiqueId_dateVente_idx" ON "Vente"("boutiqueId", "dateVente");

-- AddForeignKey
ALTER TABLE "RapportArchive" ADD CONSTRAINT "RapportArchive_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

