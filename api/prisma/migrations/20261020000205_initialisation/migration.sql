-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PROPRIETAIRE', 'GERANT', 'VENDEUR');

-- CreateEnum
CREATE TYPE "TypeProduit" AS ENUM ('TELEPHONE', 'ACCESSOIRE');

-- CreateEnum
CREATE TYPE "EtatProduit" AS ENUM ('NEUF', 'OCCASION');

-- CreateEnum
CREATE TYPE "StatutArticle" AS ENUM ('EN_STOCK', 'A_REPARER', 'VENDU', 'EN_TRANSFERT', 'REBUT');

-- CreateEnum
CREATE TYPE "OrigineArticle" AS ENUM ('ACHAT', 'TROC', 'INVENTAIRE');

-- CreateEnum
CREATE TYPE "TypeMouvement" AS ENUM ('ACHAT', 'VENTE', 'ANNULATION_VENTE', 'RETOUR', 'TROC_ENTREE', 'TRANSFERT_SORTIE', 'TRANSFERT_ENTREE', 'AJUSTEMENT', 'REBUT');

-- CreateEnum
CREATE TYPE "TypeClient" AS ENUM ('DETAIL', 'GROSSISTE');

-- CreateEnum
CREATE TYPE "TypePiece" AS ENUM ('CNI', 'PASSEPORT', 'PERMIS', 'CARTE_CONSULAIRE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutAchat" AS ENUM ('BROUILLON', 'PARTIEL', 'RECU', 'ANNULE');

-- CreateEnum
CREATE TYPE "ModeVente" AS ENUM ('COMPTANT', 'CREDIT');

-- CreateEnum
CREATE TYPE "StatutVente" AS ENUM ('VALIDEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "Tarif" AS ENUM ('DETAIL', 'GROS');

-- CreateEnum
CREATE TYPE "MoyenPaiement" AS ENUM ('ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'VIREMENT');

-- CreateEnum
CREATE TYPE "TypeRetour" AS ENUM ('REMBOURSEMENT', 'AVOIR', 'ECHANGE');

-- CreateEnum
CREATE TYPE "DestinationRetour" AS ENUM ('REMISE_EN_STOCK', 'REBUT');

-- CreateEnum
CREATE TYPE "StatutCaisse" AS ENUM ('OUVERTE', 'CLOTUREE', 'VALIDEE');

-- CreateEnum
CREATE TYPE "CategorieDepense" AS ENUM ('LOYER', 'ELECTRICITE', 'TRANSPORT', 'SALAIRE', 'ENTRETIEN', 'AUTRE');

-- CreateEnum
CREATE TYPE "EtatComposant" AS ENUM ('BON', 'MOYEN', 'MAUVAIS');

-- CreateEnum
CREATE TYPE "EtatReprise" AS ENUM ('EXCELLENT', 'BON', 'MOYEN', 'MAUVAIS');

-- CreateEnum
CREATE TYPE "MotifImeiSignale" AS ENUM ('VOLE', 'BLOQUE');

-- CreateEnum
CREATE TYPE "FrequenceCredit" AS ENUM ('HEBDOMADAIRE', 'MENSUELLE');

-- CreateEnum
CREATE TYPE "StatutCredit" AS ENUM ('EN_COURS', 'SOLDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "StatutTransfert" AS ENUM ('DEMANDE', 'ENVOYE', 'RECU', 'ANNULE');

-- CreateEnum
CREATE TYPE "StatutInventaire" AS ENUM ('EN_COURS', 'VALIDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "CanalMessage" AS ENUM ('SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "TypeMessage" AS ENUM ('FACTURE', 'RECU', 'RAPPEL_ECHEANCE', 'RETARD_ECHEANCE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutMessage" AS ENUM ('EN_ATTENTE', 'ENVOYE', 'DELIVRE', 'ECHEC');

-- CreateEnum
CREATE TYPE "StatutOperationSync" AS ENUM ('APPLIQUEE', 'REJETEE', 'CONFLIT');

-- CreateTable
CREATE TABLE "Commerce" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "adresse" TEXT,
    "monnaie" TEXT NOT NULL DEFAULT 'GNF',
    "indicatif" TEXT NOT NULL DEFAULT '+224',
    "fuseau" TEXT NOT NULL DEFAULT 'Africa/Conakry',
    "remiseMaxVendeur" INTEGER NOT NULL DEFAULT 5,
    "remiseMaxGerant" INTEGER NOT NULL DEFAULT 15,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commerce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Boutique" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "adresse" TEXT,
    "telephone" TEXT,
    "prefixe" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Boutique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utilisateur" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "identifiant" TEXT NOT NULL,
    "telephone" TEXT,
    "motDePasseHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "role" "Role" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniereConnexion" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilisateurBoutique" (
    "utilisateurId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UtilisateurBoutique_pkey" PRIMARY KEY ("utilisateurId","boutiqueId")
);

-- CreateTable
CREATE TABLE "Appareil" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "plateforme" TEXT NOT NULL,
    "jetonHash" TEXT,
    "dernierAcces" TIMESTAMP(3),
    "curseurSync" BIGINT,
    "revoqueLe" TIMESTAMP(3),
    "revoqueParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appareil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marque" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Marque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modele" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "marqueId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Modele_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categorie" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" "TypeProduit" NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Categorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produit" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "type" "TypeProduit" NOT NULL,
    "categorieId" TEXT NOT NULL,
    "marqueId" TEXT,
    "modeleId" TEXT,
    "nom" TEXT NOT NULL,
    "capacite" TEXT,
    "couleur" TEXT,
    "etat" "EtatProduit" NOT NULL DEFAULT 'NEUF',
    "codeBarres" TEXT,
    "photoCle" TEXT,
    "garantieMois" INTEGER NOT NULL DEFAULT 0,
    "prixAchat" BIGINT NOT NULL,
    "prixDetail" BIGINT NOT NULL,
    "prixGros" BIGINT NOT NULL,
    "seuilGros" INTEGER,
    "archive" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Produit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrixBoutique" (
    "id" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "prixAchat" BIGINT,
    "prixDetail" BIGINT,
    "prixGros" BIGINT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "PrixBoutique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compatibilite" (
    "accessoireId" TEXT NOT NULL,
    "modeleId" TEXT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compatibilite_pkey" PRIMARY KEY ("accessoireId","modeleId")
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL DEFAULT 0,
    "seuilMinimum" INTEGER NOT NULL DEFAULT 0,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "imei2" TEXT,
    "numeroSerie" TEXT,
    "statut" "StatutArticle" NOT NULL DEFAULT 'EN_STOCK',
    "origine" "OrigineArticle" NOT NULL DEFAULT 'ACHAT',
    "prixAchat" BIGINT NOT NULL,
    "prixRevente" BIGINT,
    "ligneAchatId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "articleId" TEXT,
    "type" "TypeMouvement" NOT NULL,
    "quantite" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "motif" TEXT,
    "utilisateurId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventaire" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "statut" "StatutInventaire" NOT NULL DEFAULT 'EN_COURS',
    "motif" TEXT,
    "valideLe" TIMESTAMP(3),
    "valideParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Inventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneInventaire" (
    "id" TEXT NOT NULL,
    "inventaireId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "articleId" TEXT,
    "quantiteTheorique" INTEGER NOT NULL,
    "quantiteComptee" INTEGER,
    "motifEcart" TEXT,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LigneInventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "type" "TypeClient" NOT NULL DEFAULT 'DETAIL',
    "typePiece" "TypePiece",
    "numeroPiece" TEXT,
    "photoPieceCle" TEXT,
    "adresse" TEXT,
    "plafondCredit" BIGINT,
    "archive" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Garant" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "typePiece" "TypePiece",
    "numeroPiece" TEXT,
    "adresse" TEXT,
    "lien" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Garant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "adresse" TEXT,
    "note" TEXT,
    "archive" BOOLEAN NOT NULL DEFAULT false,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achat" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "fournisseurId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "statut" "StatutAchat" NOT NULL DEFAULT 'BROUILLON',
    "dateAchat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montantTotal" BIGINT NOT NULL DEFAULT 0,
    "montantPaye" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Achat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneAchat" (
    "id" TEXT NOT NULL,
    "achatId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "quantiteRecue" INTEGER NOT NULL DEFAULT 0,
    "prixAchat" BIGINT NOT NULL,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LigneAchat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vente" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clientId" TEXT,
    "vendeurId" TEXT NOT NULL,
    "caisseId" TEXT,
    "appareilId" TEXT,
    "mode" "ModeVente" NOT NULL DEFAULT 'COMPTANT',
    "statut" "StatutVente" NOT NULL DEFAULT 'VALIDEE',
    "sousTotal" BIGINT NOT NULL,
    "remise" BIGINT NOT NULL DEFAULT 0,
    "reprise" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "montantPaye" BIGINT NOT NULL,
    "renduMonnaie" BIGINT NOT NULL DEFAULT 0,
    "dateVente" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "annuleLe" TIMESTAMP(3),
    "annuleParId" TEXT,
    "motifAnnulation" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Vente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneVente" (
    "id" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "articleId" TEXT,
    "quantite" INTEGER NOT NULL,
    "tarif" "Tarif" NOT NULL DEFAULT 'DETAIL',
    "prixUnitaire" BIGINT NOT NULL,
    "remise" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "prixAchat" BIGINT NOT NULL,
    "finGarantie" TIMESTAMP(3),

    CONSTRAINT "LigneVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paiement" (
    "id" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "moyen" "MoyenPaiement" NOT NULL,
    "montant" BIGINT NOT NULL,
    "reference" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Retour" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "type" "TypeRetour" NOT NULL,
    "motif" TEXT NOT NULL,
    "montantRembourse" BIGINT NOT NULL DEFAULT 0,
    "moyenRemboursement" "MoyenPaiement",
    "venteEchangeId" TEXT,
    "caisseId" TEXT,
    "valideParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Retour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneRetour" (
    "id" TEXT NOT NULL,
    "retourId" TEXT NOT NULL,
    "ligneVenteId" TEXT NOT NULL,
    "articleId" TEXT,
    "quantite" INTEGER NOT NULL,
    "destination" "DestinationRetour" NOT NULL,
    "montant" BIGINT NOT NULL,

    CONSTRAINT "LigneRetour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caisse" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "statut" "StatutCaisse" NOT NULL DEFAULT 'OUVERTE',
    "ouverteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fondInitial" BIGINT NOT NULL,
    "clotureeLe" TIMESTAMP(3),
    "comptage" JSONB,
    "theorique" JSONB,
    "ecart" BIGINT,
    "commentaire" TEXT,
    "valideParId" TEXT,
    "valideLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Depense" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "caisseId" TEXT,
    "categorie" "CategorieDepense" NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" BIGINT NOT NULL,
    "dateDepense" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "justificatifCle" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Depense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Troc" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "venteId" TEXT,
    "articleId" TEXT,
    "modeleId" TEXT,
    "description" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "etatEcran" "EtatComposant" NOT NULL,
    "etatBatterie" "EtatComposant" NOT NULL,
    "etatBoitier" "EtatComposant" NOT NULL,
    "fonctionne" BOOLEAN NOT NULL,
    "etatGlobal" "EtatReprise" NOT NULL,
    "photoCles" TEXT[],
    "valeurProposee" BIGINT NOT NULL,
    "valeurRetenue" BIGINT NOT NULL,
    "ajustementParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Troc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrilleReprise" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "modeleId" TEXT NOT NULL,
    "capacite" TEXT,
    "etat" "EtatReprise" NOT NULL,
    "valeur" BIGINT NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "GrilleReprise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImeiSignale" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "motif" "MotifImeiSignale" NOT NULL,
    "note" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "ImeiSignale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credit" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "garantId" TEXT,
    "montantTotal" BIGINT NOT NULL,
    "apport" BIGINT NOT NULL,
    "montantFinance" BIGINT NOT NULL,
    "montantRestant" BIGINT NOT NULL,
    "nombreTranches" INTEGER NOT NULL,
    "frequence" "FrequenceCredit" NOT NULL,
    "premiereEcheance" TIMESTAMP(3) NOT NULL,
    "statut" "StatutCredit" NOT NULL DEFAULT 'EN_COURS',
    "penaliteActive" BOOLEAN NOT NULL DEFAULT false,
    "soldeLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Echeance" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "dateEcheance" TIMESTAMP(3) NOT NULL,
    "montant" BIGINT NOT NULL,
    "montantPaye" BIGINT NOT NULL DEFAULT 0,
    "penalite" BIGINT NOT NULL DEFAULT 0,
    "soldeeLe" TIMESTAMP(3),
    "dernierRappelLe" TIMESTAMP(3),
    "nombreRappels" INTEGER NOT NULL DEFAULT 0,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Echeance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encaissement" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "caisseId" TEXT,
    "moyen" "MoyenPaiement" NOT NULL,
    "montant" BIGINT NOT NULL,
    "reference" TEXT,
    "appareilId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParId" TEXT,

    CONSTRAINT "Encaissement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfert" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "boutiqueDepartId" TEXT NOT NULL,
    "boutiqueArriveeId" TEXT NOT NULL,
    "statut" "StatutTransfert" NOT NULL DEFAULT 'DEMANDE',
    "note" TEXT,
    "envoyeLe" TIMESTAMP(3),
    "envoyeParId" TEXT,
    "recuLe" TIMESTAMP(3),
    "recuParId" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,
    "creeParId" TEXT,

    CONSTRAINT "Transfert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneTransfert" (
    "id" TEXT NOT NULL,
    "transfertId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "articleId" TEXT,
    "quantite" INTEGER NOT NULL,
    "quantiteRecue" INTEGER,

    CONSTRAINT "LigneTransfert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "clientId" TEXT,
    "canal" "CanalMessage" NOT NULL,
    "type" "TypeMessage" NOT NULL,
    "destinataire" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "statut" "StatutMessage" NOT NULL DEFAULT 'EN_ATTENTE',
    "essais" INTEGER NOT NULL DEFAULT 0,
    "cout" BIGINT,
    "referenceFournisseur" TEXT,
    "erreur" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "envoyeLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalAudit" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "boutiqueId" TEXT,
    "utilisateurId" TEXT,
    "appareilId" TEXT,
    "action" TEXT NOT NULL,
    "entite" TEXT,
    "entiteId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationSync" (
    "id" TEXT NOT NULL,
    "commerceId" TEXT NOT NULL,
    "appareilId" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "boutiqueId" TEXT,
    "type" TEXT NOT NULL,
    "contenu" JSONB NOT NULL,
    "statut" "StatutOperationSync" NOT NULL,
    "motif" TEXT,
    "faiteLe" TIMESTAMP(3) NOT NULL,
    "recueLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resoluLe" TIMESTAMP(3),
    "resoluParId" TEXT,

    CONSTRAINT "OperationSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Boutique_commerceId_idx" ON "Boutique"("commerceId");

-- CreateIndex
CREATE UNIQUE INDEX "Boutique_commerceId_prefixe_key" ON "Boutique"("commerceId", "prefixe");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_identifiant_key" ON "Utilisateur"("identifiant");

-- CreateIndex
CREATE INDEX "Utilisateur_commerceId_idx" ON "Utilisateur"("commerceId");

-- CreateIndex
CREATE INDEX "UtilisateurBoutique_boutiqueId_idx" ON "UtilisateurBoutique"("boutiqueId");

-- CreateIndex
CREATE INDEX "Appareil_commerceId_idx" ON "Appareil"("commerceId");

-- CreateIndex
CREATE INDEX "Appareil_utilisateurId_idx" ON "Appareil"("utilisateurId");

-- CreateIndex
CREATE UNIQUE INDEX "Marque_commerceId_nom_key" ON "Marque"("commerceId", "nom");

-- CreateIndex
CREATE INDEX "Modele_commerceId_idx" ON "Modele"("commerceId");

-- CreateIndex
CREATE UNIQUE INDEX "Modele_marqueId_nom_key" ON "Modele"("marqueId", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "Categorie_commerceId_nom_key" ON "Categorie"("commerceId", "nom");

-- CreateIndex
CREATE INDEX "Produit_commerceId_nom_idx" ON "Produit"("commerceId", "nom");

-- CreateIndex
CREATE INDEX "Produit_modeleId_idx" ON "Produit"("modeleId");

-- CreateIndex
CREATE UNIQUE INDEX "Produit_commerceId_codeBarres_key" ON "Produit"("commerceId", "codeBarres");

-- CreateIndex
CREATE UNIQUE INDEX "PrixBoutique_produitId_boutiqueId_key" ON "PrixBoutique"("produitId", "boutiqueId");

-- CreateIndex
CREATE INDEX "Compatibilite_modeleId_idx" ON "Compatibilite"("modeleId");

-- CreateIndex
CREATE INDEX "Stock_boutiqueId_idx" ON "Stock"("boutiqueId");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_produitId_boutiqueId_key" ON "Stock"("produitId", "boutiqueId");

-- CreateIndex
CREATE INDEX "Article_boutiqueId_statut_idx" ON "Article"("boutiqueId", "statut");

-- CreateIndex
CREATE INDEX "Article_produitId_idx" ON "Article"("produitId");

-- CreateIndex
CREATE UNIQUE INDEX "Article_commerceId_imei_key" ON "Article"("commerceId", "imei");

-- CreateIndex
CREATE INDEX "MouvementStock_boutiqueId_creeLe_idx" ON "MouvementStock"("boutiqueId", "creeLe");

-- CreateIndex
CREATE INDEX "MouvementStock_produitId_idx" ON "MouvementStock"("produitId");

-- CreateIndex
CREATE INDEX "MouvementStock_articleId_idx" ON "MouvementStock"("articleId");

-- CreateIndex
CREATE INDEX "Inventaire_boutiqueId_idx" ON "Inventaire"("boutiqueId");

-- CreateIndex
CREATE INDEX "LigneInventaire_inventaireId_idx" ON "LigneInventaire"("inventaireId");

-- CreateIndex
CREATE INDEX "Client_commerceId_telephone_idx" ON "Client"("commerceId", "telephone");

-- CreateIndex
CREATE INDEX "Client_commerceId_nom_idx" ON "Client"("commerceId", "nom");

-- CreateIndex
CREATE INDEX "Garant_clientId_idx" ON "Garant"("clientId");

-- CreateIndex
CREATE INDEX "Fournisseur_commerceId_nom_idx" ON "Fournisseur"("commerceId", "nom");

-- CreateIndex
CREATE INDEX "Achat_fournisseurId_idx" ON "Achat"("fournisseurId");

-- CreateIndex
CREATE UNIQUE INDEX "Achat_commerceId_numero_key" ON "Achat"("commerceId", "numero");

-- CreateIndex
CREATE INDEX "LigneAchat_achatId_idx" ON "LigneAchat"("achatId");

-- CreateIndex
CREATE INDEX "Vente_commerceId_dateVente_idx" ON "Vente"("commerceId", "dateVente");

-- CreateIndex
CREATE INDEX "Vente_clientId_idx" ON "Vente"("clientId");

-- CreateIndex
CREATE INDEX "Vente_vendeurId_idx" ON "Vente"("vendeurId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_boutiqueId_numero_key" ON "Vente"("boutiqueId", "numero");

-- CreateIndex
CREATE INDEX "LigneVente_venteId_idx" ON "LigneVente"("venteId");

-- CreateIndex
CREATE INDEX "LigneVente_articleId_idx" ON "LigneVente"("articleId");

-- CreateIndex
CREATE INDEX "LigneVente_produitId_idx" ON "LigneVente"("produitId");

-- CreateIndex
CREATE INDEX "Paiement_venteId_idx" ON "Paiement"("venteId");

-- CreateIndex
CREATE INDEX "Retour_venteId_idx" ON "Retour"("venteId");

-- CreateIndex
CREATE INDEX "LigneRetour_retourId_idx" ON "LigneRetour"("retourId");

-- CreateIndex
CREATE INDEX "Caisse_boutiqueId_ouverteLe_idx" ON "Caisse"("boutiqueId", "ouverteLe");

-- CreateIndex
CREATE INDEX "Caisse_utilisateurId_idx" ON "Caisse"("utilisateurId");

-- CreateIndex
CREATE INDEX "Depense_boutiqueId_dateDepense_idx" ON "Depense"("boutiqueId", "dateDepense");

-- CreateIndex
CREATE UNIQUE INDEX "Troc_venteId_key" ON "Troc"("venteId");

-- CreateIndex
CREATE UNIQUE INDEX "Troc_articleId_key" ON "Troc"("articleId");

-- CreateIndex
CREATE INDEX "Troc_commerceId_imei_idx" ON "Troc"("commerceId", "imei");

-- CreateIndex
CREATE INDEX "GrilleReprise_modeleId_idx" ON "GrilleReprise"("modeleId");

-- CreateIndex
CREATE UNIQUE INDEX "ImeiSignale_commerceId_imei_key" ON "ImeiSignale"("commerceId", "imei");

-- CreateIndex
CREATE UNIQUE INDEX "Credit_venteId_key" ON "Credit"("venteId");

-- CreateIndex
CREATE INDEX "Credit_commerceId_statut_idx" ON "Credit"("commerceId", "statut");

-- CreateIndex
CREATE INDEX "Credit_clientId_idx" ON "Credit"("clientId");

-- CreateIndex
CREATE INDEX "Echeance_dateEcheance_idx" ON "Echeance"("dateEcheance");

-- CreateIndex
CREATE UNIQUE INDEX "Echeance_creditId_numero_key" ON "Echeance"("creditId", "numero");

-- CreateIndex
CREATE INDEX "Encaissement_creditId_idx" ON "Encaissement"("creditId");

-- CreateIndex
CREATE INDEX "Transfert_boutiqueDepartId_idx" ON "Transfert"("boutiqueDepartId");

-- CreateIndex
CREATE INDEX "Transfert_boutiqueArriveeId_idx" ON "Transfert"("boutiqueArriveeId");

-- CreateIndex
CREATE UNIQUE INDEX "Transfert_commerceId_numero_key" ON "Transfert"("commerceId", "numero");

-- CreateIndex
CREATE INDEX "LigneTransfert_transfertId_idx" ON "LigneTransfert"("transfertId");

-- CreateIndex
CREATE INDEX "Message_commerceId_creeLe_idx" ON "Message"("commerceId", "creeLe");

-- CreateIndex
CREATE INDEX "Message_statut_idx" ON "Message"("statut");

-- CreateIndex
CREATE INDEX "JournalAudit_commerceId_creeLe_idx" ON "JournalAudit"("commerceId", "creeLe");

-- CreateIndex
CREATE INDEX "JournalAudit_utilisateurId_idx" ON "JournalAudit"("utilisateurId");

-- CreateIndex
CREATE INDEX "OperationSync_commerceId_statut_idx" ON "OperationSync"("commerceId", "statut");

-- CreateIndex
CREATE INDEX "OperationSync_appareilId_idx" ON "OperationSync"("appareilId");

-- AddForeignKey
ALTER TABLE "Boutique" ADD CONSTRAINT "Boutique_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utilisateur" ADD CONSTRAINT "Utilisateur_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisateurBoutique" ADD CONSTRAINT "UtilisateurBoutique_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisateurBoutique" ADD CONSTRAINT "UtilisateurBoutique_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appareil" ADD CONSTRAINT "Appareil_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appareil" ADD CONSTRAINT "Appareil_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marque" ADD CONSTRAINT "Marque_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modele" ADD CONSTRAINT "Modele_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modele" ADD CONSTRAINT "Modele_marqueId_fkey" FOREIGN KEY ("marqueId") REFERENCES "Marque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Categorie" ADD CONSTRAINT "Categorie_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produit" ADD CONSTRAINT "Produit_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produit" ADD CONSTRAINT "Produit_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produit" ADD CONSTRAINT "Produit_marqueId_fkey" FOREIGN KEY ("marqueId") REFERENCES "Marque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produit" ADD CONSTRAINT "Produit_modeleId_fkey" FOREIGN KEY ("modeleId") REFERENCES "Modele"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrixBoutique" ADD CONSTRAINT "PrixBoutique_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrixBoutique" ADD CONSTRAINT "PrixBoutique_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compatibilite" ADD CONSTRAINT "Compatibilite_accessoireId_fkey" FOREIGN KEY ("accessoireId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compatibilite" ADD CONSTRAINT "Compatibilite_modeleId_fkey" FOREIGN KEY ("modeleId") REFERENCES "Modele"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stock" ADD CONSTRAINT "Stock_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_ligneAchatId_fkey" FOREIGN KEY ("ligneAchatId") REFERENCES "LigneAchat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_inventaireId_fkey" FOREIGN KEY ("inventaireId") REFERENCES "Inventaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garant" ADD CONSTRAINT "Garant_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fournisseur" ADD CONSTRAINT "Fournisseur_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achat" ADD CONSTRAINT "Achat_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achat" ADD CONSTRAINT "Achat_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achat" ADD CONSTRAINT "Achat_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneAchat" ADD CONSTRAINT "LigneAchat_achatId_fkey" FOREIGN KEY ("achatId") REFERENCES "Achat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneAchat" ADD CONSTRAINT "LigneAchat_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_vendeurId_fkey" FOREIGN KEY ("vendeurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_venteEchangeId_fkey" FOREIGN KEY ("venteEchangeId") REFERENCES "Vente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retour" ADD CONSTRAINT "Retour_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneRetour" ADD CONSTRAINT "LigneRetour_retourId_fkey" FOREIGN KEY ("retourId") REFERENCES "Retour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneRetour" ADD CONSTRAINT "LigneRetour_ligneVenteId_fkey" FOREIGN KEY ("ligneVenteId") REFERENCES "LigneVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneRetour" ADD CONSTRAINT "LigneRetour_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caisse" ADD CONSTRAINT "Caisse_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caisse" ADD CONSTRAINT "Caisse_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caisse" ADD CONSTRAINT "Caisse_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Depense" ADD CONSTRAINT "Depense_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Depense" ADD CONSTRAINT "Depense_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Depense" ADD CONSTRAINT "Depense_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troc" ADD CONSTRAINT "Troc_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troc" ADD CONSTRAINT "Troc_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troc" ADD CONSTRAINT "Troc_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troc" ADD CONSTRAINT "Troc_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troc" ADD CONSTRAINT "Troc_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Troc" ADD CONSTRAINT "Troc_modeleId_fkey" FOREIGN KEY ("modeleId") REFERENCES "Modele"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrilleReprise" ADD CONSTRAINT "GrilleReprise_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrilleReprise" ADD CONSTRAINT "GrilleReprise_modeleId_fkey" FOREIGN KEY ("modeleId") REFERENCES "Modele"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImeiSignale" ADD CONSTRAINT "ImeiSignale_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_boutiqueId_fkey" FOREIGN KEY ("boutiqueId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_garantId_fkey" FOREIGN KEY ("garantId") REFERENCES "Garant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Echeance" ADD CONSTRAINT "Echeance_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encaissement" ADD CONSTRAINT "Encaissement_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encaissement" ADD CONSTRAINT "Encaissement_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encaissement" ADD CONSTRAINT "Encaissement_caisseId_fkey" FOREIGN KEY ("caisseId") REFERENCES "Caisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfert" ADD CONSTRAINT "Transfert_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfert" ADD CONSTRAINT "Transfert_boutiqueDepartId_fkey" FOREIGN KEY ("boutiqueDepartId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfert" ADD CONSTRAINT "Transfert_boutiqueArriveeId_fkey" FOREIGN KEY ("boutiqueArriveeId") REFERENCES "Boutique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneTransfert" ADD CONSTRAINT "LigneTransfert_transfertId_fkey" FOREIGN KEY ("transfertId") REFERENCES "Transfert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneTransfert" ADD CONSTRAINT "LigneTransfert_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneTransfert" ADD CONSTRAINT "LigneTransfert_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalAudit" ADD CONSTRAINT "JournalAudit_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSync" ADD CONSTRAINT "OperationSync_commerceId_fkey" FOREIGN KEY ("commerceId") REFERENCES "Commerce"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationSync" ADD CONSTRAINT "OperationSync_appareilId_fkey" FOREIGN KEY ("appareilId") REFERENCES "Appareil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
