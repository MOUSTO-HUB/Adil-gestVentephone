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
