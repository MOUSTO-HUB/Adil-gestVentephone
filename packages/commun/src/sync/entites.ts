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
  'retour',
  'ligneRetour',
  'caisse',
  'depense',
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
  /** Avoirs non utilisés, payables comme moyen « Avoir ». */
  soldeAvoir: number;
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
  /** Valeur des articles rendus déduite (échange, troc). */
  reprise: number;
  total: number;
  caisseId: string | null;
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
  moyen: 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT' | 'AVOIR';
  montant: number;
  reference: string | null;
}

/** Retour ou échange (les 60 derniers jours sur les appareils, comme les ventes). */
export interface RetourSync {
  id: string;
  boutiqueId: string;
  venteId: string;
  type: 'REMBOURSEMENT' | 'AVOIR' | 'ECHANGE';
  etatAppareil: 'INTACT' | 'DEFECTUEUX' | 'ENDOMMAGE';
  motif: string;
  valeur: number;
  montantRembourse: number;
  moyenRemboursement: 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT' | null;
  referenceRemboursement: string | null;
  avoir: number;
  venteEchangeId: string | null;
  caisseId: string | null;
  dateRetour: string;
  creeParId: string | null;
  valideParId: string | null;
}

export interface LigneRetourSync {
  id: string;
  retourId: string;
  ligneVenteId: string;
  articleId: string | null;
  quantite: number;
  destination: 'REMISE_EN_STOCK' | 'OCCASION' | 'REBUT';
  montant: number;
  prixRevente: number | null;
}

/** Session de caisse d'un vendeur (60 derniers jours, et toute caisse encore ouverte). */
export interface CaisseSync {
  id: string;
  boutiqueId: string;
  utilisateurId: string;
  /** Nom du vendeur (rapport de clôture). */
  vendeur: string;
  statut: 'OUVERTE' | 'CLOTUREE' | 'VALIDEE';
  ouverteLe: string;
  fondInitial: number;
  clotureeLe: string | null;
  comptage: Record<'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT', number> | null;
  theorique: Record<'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT', number> | null;
  ecart: number | null;
  commentaire: string | null;
  validePar: string | null;
  valideLe: string | null;
  commentaireValidation: string | null;
}

export interface DepenseSync {
  id: string;
  boutiqueId: string;
  caisseId: string | null;
  categorie: 'LOYER' | 'ELECTRICITE' | 'TRANSPORT' | 'SALAIRE' | 'ENTRETIEN' | 'AUTRE';
  libelle: string;
  montant: number;
  moyen: 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT';
  dateDepense: string;
  /** Une photo du justificatif existe (lue en ligne). */
  justificatif: boolean;
  creeParId: string | null;
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
  retour: RetourSync;
  ligneRetour: LigneRetourSync;
  caisse: CaisseSync;
  depense: DepenseSync;
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
