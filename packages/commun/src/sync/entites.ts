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
  'troc',
  'grilleReprise',
  'imeiSignale',
  'credit',
  'echeance',
  'encaissement',
  'transfert',
  'ligneTransfert',
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

/** Reprise d'un ancien téléphone (60 derniers jours sur les appareils, comme les ventes). */
export interface TrocSync {
  id: string;
  boutiqueId: string;
  clientId: string;
  venteId: string | null;
  articleId: string | null;
  modeleId: string | null;
  imei: string;
  etatEcran: 'BON' | 'MOYEN' | 'MAUVAIS';
  etatBatterie: 'BON' | 'MOYEN' | 'MAUVAIS';
  etatBoitier: 'BON' | 'MOYEN' | 'MAUVAIS';
  fonctionne: boolean;
  etatGlobal: 'EXCELLENT' | 'BON' | 'MOYEN' | 'MAUVAIS';
  note: string;
  valeurProposee: number;
  valeurRetenue: number;
  /** Nombre de photos de l'appareil (lues en ligne). */
  photos: number;
  ajustementParId: string | null;
  creeLe: string;
  creeParId: string | null;
}

/** Ligne de la grille de reprise (catalogue commun du commerce). */
export interface GrilleRepriseSync {
  id: string;
  modeleId: string;
  capacite: string | null;
  etat: 'EXCELLENT' | 'BON' | 'MOYEN' | 'MAUVAIS';
  valeur: number;
}

/** IMEI signalé volé ou bloqué par le commerce (vérifié hors ligne à la reprise). */
export interface ImeiSignaleSync {
  id: string;
  imei: string;
  motif: 'VOLE' | 'BLOQUE';
  note: string | null;
  actif: boolean;
}

/** Crédit d'une vente (tous ceux en cours, les autres des 60 derniers jours). */
export interface CreditSync {
  id: string;
  boutiqueId: string;
  venteId: string;
  /** Numéro de la facture (la vente peut être plus ancienne que l'instantané). */
  numeroVente: string;
  clientId: string;
  garantId: string | null;
  montantTotal: number;
  apport: number;
  montantFinance: number;
  /** Reste dû, pénalités comprises. */
  montantRestant: number;
  nombreTranches: number;
  frequence: 'HEBDOMADAIRE' | 'MENSUELLE';
  /** AAAA-MM-JJ. */
  premiereEcheance: string;
  statut: 'EN_COURS' | 'SOLDE' | 'ANNULE';
  penaliteActive: boolean;
  soldeLe: string | null;
  creeLe: string;
  creeParId: string | null;
}

export interface EcheanceSync {
  id: string;
  creditId: string;
  numero: number;
  /** AAAA-MM-JJ. */
  dateEcheance: string;
  montant: number;
  montantPaye: number;
  penalite: number;
  soldeeLe: string | null;
  /** Jour (AAAA-MM-JJ) du dernier rappel envoyé, ou null. */
  dernierRappel: string | null;
  nombreRelances: number;
}

/** Tranche encaissée (totale ou partielle). */
export interface EncaissementSync {
  id: string;
  creditId: string;
  caisseId: string | null;
  moyen: 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT';
  montant: number;
  reference: string | null;
  creeLe: string;
  creeParId: string | null;
}

/** Transfert entre deux boutiques (connu des appareils des deux boutiques). */
export interface TransfertSync {
  id: string;
  numero: string;
  boutiqueDepartId: string;
  boutiqueArriveeId: string;
  statut: 'DEMANDE' | 'ENVOYE' | 'RECU' | 'ANNULE';
  note: string | null;
  noteReception: string | null;
  envoyeLe: string | null;
  recuLe: string | null;
  creeLe: string;
  creeParId: string | null;
}

export interface LigneTransfertSync {
  id: string;
  transfertId: string;
  produitId: string;
  articleId: string | null;
  /** IMEI du téléphone (scan à l'arrivée, l'article n'étant pas encore dans la boutique). */
  imei: string | null;
  quantite: number;
  /** Nul tant que le transfert n'est pas reçu. */
  quantiteRecue: number | null;
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
  troc: TrocSync;
  grilleReprise: GrilleRepriseSync;
  imeiSignale: ImeiSignaleSync;
  credit: CreditSync;
  echeance: EcheanceSync;
  encaissement: EncaissementSync;
  transfert: TransfertSync;
  ligneTransfert: LigneTransfertSync;
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
  /** Boutiques de l'utilisateur (triées) : si elles changent, l'appareil reprend tout. */
  boutiques: string[];
  donnees: { [E in EntiteSync]: DonneesEntites[E][] };
}

export interface PageChangements {
  changements: Changement[];
  /** Boutiques de l'utilisateur (triées). */
  boutiques: string[];
  curseur: number;
  /** D'autres changements attendent : redemander avec le nouveau curseur. */
  plus: boolean;
}
