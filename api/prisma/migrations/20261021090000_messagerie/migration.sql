-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "boutiqueId" TEXT;

-- AlterTable
ALTER TABLE "Vente" ADD COLUMN     "codePublic" TEXT;

-- CreateTable
CREATE TABLE "ModeleMessage" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "type" "TypeMessage" NOT NULL,
    "canal" "CanalMessage" NOT NULL,
    "texte" TEXT NOT NULL,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "modifieParId" TEXT,

    CONSTRAINT "ModeleMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModeleMessage_commerceId_type_canal_key" ON "ModeleMessage"("commerceId", "type", "canal");

-- CreateIndex
CREATE INDEX "Message_referenceType_referenceId_idx" ON "Message"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_codePublic_key" ON "Vente"("codePublic");

-- AddForeignKey
ALTER TABLE "ModeleMessage" ADD CONSTRAINT "ModeleMessage_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

