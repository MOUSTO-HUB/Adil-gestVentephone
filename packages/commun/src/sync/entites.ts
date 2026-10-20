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
  'client',
  'garant',
  'fournisseur',
  'achat',
  'ligneAchat',
  'vente',
  'ligneVente',
  'paiementVente',
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
  /** Nom du fichier photo (servi par GET /api/photos/:photo), nul sans photo. */
  photo: string | null;
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

export interface ClientSync {
  id: string;
  nom: string;
  /** Format E.164. */
  telephone: string;
  type: 'DETAIL' | 'GROSSISTE';
  typePiece: 'CNI' | 'PASSEPORT' | 'PERMIS' | 'CARTE_CONSULAIRE' | 'AUTRE' | null;
  numeroPiece: string | null;
  adresse: string | null;
  plafondCredit: number | null;
  archive: boolean;
  /** Une photo de la pièce d'identité existe (lue en ligne, jamais mise en cache). */
  photoPiece: boolean;
}

export interface GarantSync {
  id: string;
  clientId: string;
  nom: string;
  telephone: string;
  typePiece: ClientSync['typePiece'];
  numeroPiece: string | null;
  adresse: string | null;
  lien: string | null;
}

/** Fournisseur (propriétaire et gérants seulement). */
export interface FournisseurSync {
  id: string;
  nom: string;
  telephone: string | null;
  adresse: string | null;
  note: string | null;
  archive: boolean;
  /** Reste dû au fournisseur sur ses bons d'achat. */
  dette: number;
}

/** Bon d'achat fournisseur (propriétaire et gérants seulement). */
export interface AchatSync {
  id: string;
  boutiqueId: string;
  fournisseurId: string;
  numero: string;
  statut: 'BROUILLON' | 'PARTIEL' | 'RECU' | 'ANNULE';
  /** Date du bon (AAAA-MM-JJ). */
  dateAchat: string;
  montantTotal: number;
  montantPaye: number;
  note: string | null;
}

export interface LigneAchatSync {
  id: string;
  achatId: string;
  produitId: string;
  quantite: number;
  quantiteRecue: number;
  prixAchat: number;
}

/** Vente de la boutique (les 60 derniers jours sur les appareils). */
export interface VenteSync {
  id: string;
  boutiqueId: string;
  numero: string;
  clientId: string | null;
  vendeurId: string;
  mode: 'COMPTANT' | 'CREDIT';
  statut: 'VALIDEE' | 'ANNULEE';
  sousTotal: number;
  remise: number;
  total: number;
  montantPaye: number;
  renduMonnaie: number;
  dateVente: string;
  annuleLe: string | null;
  motifAnnulation: string | null;
}

export interface LigneVenteSync {
  id: string;
  venteId: string;
  produitId: string;
  articleId: string | null;
  quantite: number;
  tarif: 'DETAIL' | 'GROS';
  prixUnitaire: number;
  total: number;
  /** Coût au moment de la vente (nul pour un vendeur). */
  prixAchat: number | null;
  finGarantie: string | null;
}

export interface PaiementVenteSync {
  id: string;
  venteId: string;
  moyen: 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT';
  montant: number;
  reference: string | null;
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
  client: ClientSync;
  garant: GarantSync;
  fournisseur: FournisseurSync;
  achat: AchatSync;
  ligneAchat: LigneAchatSync;
  vente: VenteSync;
  ligneVente: LigneVenteSync;
  paiementVente: PaiementVenteSync;
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
