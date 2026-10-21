import type { BaseSql } from './sql';

/**
 * Migrations de la base locale, dans l'ordre. Ne jamais modifier une migration
 * déjà publiée : en ajouter une nouvelle. La version courante est dans PRAGMA user_version.
 */
export const MIGRATIONS: string[] = [
  // 1 : catalogue, stock et file sortante.
  `
  CREATE TABLE marque (id TEXT PRIMARY KEY, nom TEXT NOT NULL);
  CREATE TABLE modele (id TEXT PRIMARY KEY, marqueId TEXT NOT NULL, nom TEXT NOT NULL);
  CREATE TABLE categorie (id TEXT PRIMARY KEY, nom TEXT NOT NULL, type TEXT NOT NULL);
  CREATE TABLE produit (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    categorieId TEXT NOT NULL,
    marqueId TEXT,
    modeleId TEXT,
    nom TEXT NOT NULL,
    capacite TEXT,
    couleur TEXT,
    etat TEXT NOT NULL,
    codeBarres TEXT,
    garantieMois INTEGER NOT NULL,
    prixAchat INTEGER,
    prixDetail INTEGER NOT NULL,
    prixGros INTEGER NOT NULL,
    seuilGros INTEGER,
    archive INTEGER NOT NULL
  );
  CREATE INDEX produit_nom ON produit (nom);
  CREATE INDEX produit_code_barres ON produit (codeBarres);
  CREATE TABLE prixBoutique (
    id TEXT PRIMARY KEY,
    produitId TEXT NOT NULL,
    boutiqueId TEXT NOT NULL,
    prixAchat INTEGER,
    prixDetail INTEGER,
    prixGros INTEGER,
    UNIQUE (produitId, boutiqueId)
  );
  CREATE TABLE compatibilite (id TEXT PRIMARY KEY, accessoireId TEXT NOT NULL, modeleId TEXT NOT NULL);
  CREATE INDEX compatibilite_modele ON compatibilite (modeleId);
  CREATE TABLE stock (
    id TEXT PRIMARY KEY,
    produitId TEXT NOT NULL,
    boutiqueId TEXT NOT NULL,
    quantite INTEGER NOT NULL,
    seuilMinimum INTEGER NOT NULL,
    UNIQUE (produitId, boutiqueId)
  );
  CREATE TABLE article (
    id TEXT PRIMARY KEY,
    produitId TEXT NOT NULL,
    boutiqueId TEXT NOT NULL,
    imei TEXT NOT NULL,
    imei2 TEXT,
    numeroSerie TEXT,
    statut TEXT NOT NULL,
    origine TEXT NOT NULL,
    prixAchat INTEGER,
    prixRevente INTEGER
  );
  CREATE INDEX article_imei ON article (imei);
  CREATE INDEX article_produit ON article (produitId, boutiqueId, statut);
  CREATE TABLE operation (
    ordre INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    boutiqueId TEXT NOT NULL,
    faiteLe TEXT NOT NULL,
    contenu TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'EN_ATTENTE',
    motif TEXT
  );
  CREATE TABLE meta (cle TEXT PRIMARY KEY, valeur TEXT);
  `,
  // 2 : photo des produits et texte de recherche (minuscules, sans accents ; rempli par depot.ts).
  `
  ALTER TABLE produit ADD COLUMN photo TEXT;
  ALTER TABLE produit ADD COLUMN recherche TEXT;
  CREATE INDEX article_boutique_imei ON article (boutiqueId, imei);
  `,
  // 3 : clients, garants et fournisseurs.
  `
  CREATE TABLE client (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    telephone TEXT NOT NULL,
    type TEXT NOT NULL,
    typePiece TEXT,
    numeroPiece TEXT,
    adresse TEXT,
    plafondCredit INTEGER,
    archive INTEGER NOT NULL,
    photoPiece INTEGER NOT NULL,
    recherche TEXT
  );
  CREATE INDEX client_telephone ON client (telephone);
  CREATE TABLE garant (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    nom TEXT NOT NULL,
    telephone TEXT NOT NULL,
    typePiece TEXT,
    numeroPiece TEXT,
    adresse TEXT,
    lien TEXT
  );
  CREATE INDEX garant_client ON garant (clientId);
  CREATE TABLE fournisseur (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    telephone TEXT,
    adresse TEXT,
    note TEXT,
    archive INTEGER NOT NULL,
    dette INTEGER NOT NULL
  );
  `,
  // 4 : bons d'achat fournisseur.
  `
  CREATE TABLE achat (
    id TEXT PRIMARY KEY,
    boutiqueId TEXT NOT NULL,
    fournisseurId TEXT NOT NULL,
    numero TEXT NOT NULL,
    statut TEXT NOT NULL,
    dateAchat TEXT NOT NULL,
    montantTotal INTEGER NOT NULL,
    montantPaye INTEGER NOT NULL,
    note TEXT
  );
  CREATE INDEX achat_boutique ON achat (boutiqueId, dateAchat);
  CREATE TABLE ligneAchat (
    id TEXT PRIMARY KEY,
    achatId TEXT NOT NULL,
    produitId TEXT NOT NULL,
    quantite INTEGER NOT NULL,
    quantiteRecue INTEGER NOT NULL,
    prixAchat INTEGER NOT NULL
  );
  CREATE INDEX ligne_achat_achat ON ligneAchat (achatId);
  `,
  // 5 : ventes, lignes et paiements.
  `
  CREATE TABLE vente (
    id TEXT PRIMARY KEY,
    boutiqueId TEXT NOT NULL,
    numero TEXT NOT NULL,
    clientId TEXT,
    vendeurId TEXT NOT NULL,
    mode TEXT NOT NULL,
    statut TEXT NOT NULL,
    sousTotal INTEGER NOT NULL,
    remise INTEGER NOT NULL,
    total INTEGER NOT NULL,
    montantPaye INTEGER NOT NULL,
    renduMonnaie INTEGER NOT NULL,
    dateVente TEXT NOT NULL,
    annuleLe TEXT,
    motifAnnulation TEXT
  );
  CREATE INDEX vente_boutique_date ON vente (boutiqueId, dateVente);
  CREATE TABLE ligneVente (
    id TEXT PRIMARY KEY,
    venteId TEXT NOT NULL,
    produitId TEXT NOT NULL,
    articleId TEXT,
    quantite INTEGER NOT NULL,
    tarif TEXT NOT NULL,
    prixUnitaire INTEGER NOT NULL,
    total INTEGER NOT NULL,
    prixAchat INTEGER,
    finGarantie TEXT
  );
  CREATE INDEX ligne_vente_vente ON ligneVente (venteId);
  CREATE TABLE paiementVente (
    id TEXT PRIMARY KEY,
    venteId TEXT NOT NULL,
    moyen TEXT NOT NULL,
    montant INTEGER NOT NULL,
    reference TEXT
  );
  CREATE INDEX paiement_vente_vente ON paiementVente (venteId);
  `,
  // 6 : retours et échanges, avoir des clients, reprise déduite d'une vente.
  `
  ALTER TABLE client ADD COLUMN soldeAvoir INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE vente ADD COLUMN reprise INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE retour (
    id TEXT PRIMARY KEY,
    boutiqueId TEXT NOT NULL,
    venteId TEXT NOT NULL,
    type TEXT NOT NULL,
    etatAppareil TEXT NOT NULL,
    motif TEXT NOT NULL,
    valeur INTEGER NOT NULL,
    montantRembourse INTEGER NOT NULL,
    moyenRemboursement TEXT,
    referenceRemboursement TEXT,
    avoir INTEGER NOT NULL,
    venteEchangeId TEXT,
    dateRetour TEXT NOT NULL,
    creeParId TEXT,
    valideParId TEXT
  );
  CREATE INDEX retour_vente ON retour (venteId);
  CREATE INDEX retour_boutique_date ON retour (boutiqueId, dateRetour);
  CREATE TABLE ligneRetour (
    id TEXT PRIMARY KEY,
    retourId TEXT NOT NULL,
    ligneVenteId TEXT NOT NULL,
    articleId TEXT,
    quantite INTEGER NOT NULL,
    destination TEXT NOT NULL,
    montant INTEGER NOT NULL,
    prixRevente INTEGER
  );
  CREATE INDEX ligne_retour_retour ON ligneRetour (retourId);
  CREATE INDEX ligne_retour_ligne_vente ON ligneRetour (ligneVenteId);
  `,
  // 7 : caisses et dépenses.
  `
  ALTER TABLE vente ADD COLUMN caisseId TEXT;
  ALTER TABLE retour ADD COLUMN caisseId TEXT;
  CREATE INDEX vente_caisse ON vente (caisseId);
  CREATE TABLE caisse (
    id TEXT PRIMARY KEY,
    boutiqueId TEXT NOT NULL,
    utilisateurId TEXT NOT NULL,
    vendeur TEXT NOT NULL,
    statut TEXT NOT NULL,
    ouverteLe TEXT NOT NULL,
    fondInitial INTEGER NOT NULL,
    clotureeLe TEXT,
    comptage TEXT,
    theorique TEXT,
    ecart INTEGER,
    commentaire TEXT,
    validePar TEXT,
    valideLe TEXT,
    commentaireValidation TEXT
  );
  CREATE INDEX caisse_boutique ON caisse (boutiqueId, ouverteLe);
  CREATE TABLE depense (
    id TEXT PRIMARY KEY,
    boutiqueId TEXT NOT NULL,
    caisseId TEXT,
    categorie TEXT NOT NULL,
    libelle TEXT NOT NULL,
    montant INTEGER NOT NULL,
    moyen TEXT NOT NULL,
    dateDepense TEXT NOT NULL,
    justificatif INTEGER NOT NULL,
    creeParId TEXT
  );
  CREATE INDEX depense_boutique ON depense (boutiqueId, dateDepense);
  CREATE INDEX depense_caisse ON depense (caisseId);
  `,
  // Troc : reprises, grille de reprise, IMEI signalés volés ou bloqués.
  `
  CREATE TABLE troc (
    id TEXT PRIMARY KEY,
    boutiqueId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    venteId TEXT,
    articleId TEXT,
    modeleId TEXT,
    imei TEXT NOT NULL,
    etatEcran TEXT NOT NULL,
    etatBatterie TEXT NOT NULL,
    etatBoitier TEXT NOT NULL,
    fonctionne INTEGER NOT NULL,
    etatGlobal TEXT NOT NULL,
    note TEXT NOT NULL,
    valeurProposee INTEGER NOT NULL,
    valeurRetenue INTEGER NOT NULL,
    photos INTEGER NOT NULL,
    ajustementParId TEXT,
    creeLe TEXT NOT NULL,
    creeParId TEXT
  );
  CREATE INDEX troc_boutique ON troc (boutiqueId, creeLe);
  CREATE INDEX troc_vente ON troc (venteId);
  CREATE TABLE grilleReprise (
    id TEXT PRIMARY KEY,
    modeleId TEXT NOT NULL,
    capacite TEXT,
    etat TEXT NOT NULL,
    valeur INTEGER NOT NULL
  );
  CREATE INDEX grille_modele ON grilleReprise (modeleId);
  CREATE TABLE imeiSignale (
    id TEXT PRIMARY KEY,
    imei TEXT NOT NULL,
    motif TEXT NOT NULL,
    note TEXT,
    actif INTEGER NOT NULL
  );
  CREATE INDEX imei_signale ON imeiSignale (imei);
  `,
];

/**
 * Applique les migrations manquantes, chacune dans une transaction. Une base déjà
 * remplie qui change de version oublie son curseur : la synchronisation suivante
 * reprend un instantané complet, qui remplit aussi les nouvelles tables (les
 * données existantes n'apparaissent pas dans le journal des changements).
 */
export async function migrer(base: BaseSql): Promise<number> {
  const ligne = await base.premier<{ user_version: number }>('PRAGMA user_version');
  const version = ligne?.user_version ?? 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    await base.transaction(async (tx) => {
      for (const instruction of MIGRATIONS[i]
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await tx.executer(instruction);
      }
      await tx.executer(`PRAGMA user_version = ${i + 1}`);
    });
  }
  if (version > 0 && version < MIGRATIONS.length) {
    await base.executer("DELETE FROM meta WHERE cle = 'curseur'");
  }
  return MIGRATIONS.length;
}
