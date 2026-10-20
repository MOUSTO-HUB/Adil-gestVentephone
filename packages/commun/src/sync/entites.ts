/**
 * Données synchronisées entre le serveur et la base locale des appareils.
 * Mêmes formes des deux côtés : le serveur les produit, l'application les range
 * dans SQLite. Montants en nombres entiers ; prixAchat est nul pour un vendeur.
 */

export const ENTITES_SYNC = [
  'marque',
  'modele',
  'categorie',
  'produit',
  'prixBoutique',
  'compatibilite',
  'stock',
  'article',
] as const;
export type EntiteSync = (typeof ENTITES_SYNC)[number];

export interface MarqueSync {
  id: string;
  nom: string;
}

export interface ModeleSync {
  id: string;
  marqueId: string;
  nom: string;
}

export interface CategorieSync {
  id: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
}

export interface ProduitSync {
  id: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  categorieId: string;
  marqueId: string | null;
  modeleId: string | null;
  nom: string;
  capacite: string | null;
  couleur: string | null;
  etat: 'NEUF' | 'OCCASION';
  codeBarres: string | null;
  garantieMois: number;
  prixAchat: number | null;
  prixDetail: number;
  prixGros: number;
  seuilGros: number | null;
  archive: boolean;
}

export interface PrixBoutiqueSync {
  id: string;
  produitId: string;
  boutiqueId: string;
  prixAchat: number | null;
  prixDetail: number | null;
  prixGros: number | null;
}

export interface CompatibiliteSync {
  /** « accessoireId:modeleId ». */
  id: string;
  accessoireId: string;
  modeleId: string;
}

export interface StockSync {
  id: string;
  produitId: string;
  boutiqueId: string;
  quantite: number;
  seuilMinimum: number;
}

export type StatutArticle = 'EN_STOCK' | 'A_REPARER' | 'VENDU' | 'EN_TRANSFERT' | 'REBUT';

export interface ArticleSync {
  id: string;
  produitId: string;
  boutiqueId: string;
  imei: string;
  imei2: string | null;
  numeroSerie: string | null;
  statut: StatutArticle;
  origine: 'ACHAT' | 'TROC' | 'INVENTAIRE';
  prixAchat: number | null;
  prixRevente: number | null;
}

export interface DonneesEntites {
  marque: MarqueSync;
  modele: ModeleSync;
  categorie: CategorieSync;
  produit: ProduitSync;
  prixBoutique: PrixBoutiqueSync;
  compatibilite: CompatibiliteSync;
  stock: StockSync;
  article: ArticleSync;
}

/** Un changement du journal du serveur (descente vers les appareils). */
export type Changement = {
  [E in EntiteSync]: {
    seq: number;
    entite: E;
    id: string;
    /** null : l'élément a été supprimé ou n'est plus visible pour cet appareil. */
    donnees: DonneesEntites[E] | null;
  };
}[EntiteSync];

/** État complet pour un premier remplissage de la base locale. */
export interface Instantane {
  curseur: number;
  donnees: { [E in EntiteSync]: DonneesEntites[E][] };
}

export interface PageChangements {
  changements: Changement[];
  curseur: number;
  /** D'autres changements attendent : redemander avec le nouveau curseur. */
  plus: boolean;
}
