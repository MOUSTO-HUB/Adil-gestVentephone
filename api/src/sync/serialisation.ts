import type {
  AchatSync,
  ClientSync,
  FournisseurSync,
  GarantSync,
  LigneAchatSync,
  ArticleSync,
  CategorieSync,
  CompatibiliteSync,
  DonneesEntites,
  EntiteSync,
  MarqueSync,
  ModeleSync,
  PrixBoutiqueSync,
  ProduitSync,
  StockSync,
} from '@gestvente/commun';
import type {
  Achat,
  Article,
  Client,
  Fournisseur,
  Garant,
  LigneAchat,
  Categorie,
  Compatibilite,
  Marque,
  Modele,
  PrixBoutique,
  Produit,
  Stock,
} from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

/** Lignes de la base → format synchronisé (packages/commun). */

const nombre = (valeur: bigint) => Number(valeur);
const nombreOuNul = (valeur: bigint | null) => (valeur === null ? null : Number(valeur));

export const versMarque = (m: Marque): MarqueSync => ({ id: m.id, nom: m.nom });

export const versModele = (m: Modele): ModeleSync => ({
  id: m.id,
  marqueId: m.marqueId,
  nom: m.nom,
});

export const versCategorie = (c: Categorie): CategorieSync => ({
  id: c.id,
  nom: c.nom,
  type: c.type,
});

export const versProduit = (p: Produit): ProduitSync => ({
  id: p.id,
  type: p.type,
  categorieId: p.categorieId,
  marqueId: p.marqueId,
  modeleId: p.modeleId,
  nom: p.nom,
  capacite: p.capacite,
  couleur: p.couleur,
  etat: p.etat,
  codeBarres: p.codeBarres,
  garantieMois: p.garantieMois,
  prixAchat: nombre(p.prixAchat),
  prixDetail: nombre(p.prixDetail),
  prixGros: nombre(p.prixGros),
  seuilGros: p.seuilGros,
  archive: p.archive,
  photo: p.photoCle,
});

export const versPrixBoutique = (p: PrixBoutique): PrixBoutiqueSync => ({
  id: p.id,
  produitId: p.produitId,
  boutiqueId: p.boutiqueId,
  prixAchat: nombreOuNul(p.prixAchat),
  prixDetail: nombreOuNul(p.prixDetail),
  prixGros: nombreOuNul(p.prixGros),
});

export const idCompatibilite = (accessoireId: string, modeleId: string) =>
  `${accessoireId}:${modeleId}`;

export const versCompatibilite = (c: Compatibilite): CompatibiliteSync => ({
  id: idCompatibilite(c.accessoireId, c.modeleId),
  accessoireId: c.accessoireId,
  modeleId: c.modeleId,
});

export const versStock = (s: Stock): StockSync => ({
  id: s.id,
  produitId: s.produitId,
  boutiqueId: s.boutiqueId,
  quantite: s.quantite,
  seuilMinimum: s.seuilMinimum,
});

export const versArticle = (a: Article): ArticleSync => ({
  id: a.id,
  produitId: a.produitId,
  boutiqueId: a.boutiqueId,
  imei: a.imei,
  imei2: a.imei2,
  numeroSerie: a.numeroSerie,
  statut: a.statut,
  origine: a.origine,
  prixAchat: nombre(a.prixAchat),
  prixRevente: nombreOuNul(a.prixRevente),
});

export const versClient = (c: Client): ClientSync => ({
  id: c.id,
  nom: c.nom,
  telephone: c.telephone,
  type: c.type,
  typePiece: c.typePiece,
  numeroPiece: c.numeroPiece,
  adresse: c.adresse,
  plafondCredit: nombreOuNul(c.plafondCredit),
  archive: c.archive,
  photoPiece: c.photoPieceCle !== null,
});

export const versGarant = (g: Garant): GarantSync => ({
  id: g.id,
  clientId: g.clientId,
  nom: g.nom,
  telephone: g.telephone,
  typePiece: g.typePiece,
  numeroPiece: g.numeroPiece,
  adresse: g.adresse,
  lien: g.lien,
});

/** dette : reste dû sur les bons d'achat du fournisseur (calculé par l'appelant). */
export const versFournisseur = (f: Fournisseur, dette: number): FournisseurSync => ({
  id: f.id,
  nom: f.nom,
  telephone: f.telephone,
  adresse: f.adresse,
  note: f.note,
  archive: f.archive,
  dette,
});

export const versAchat = (a: Achat): AchatSync => ({
  id: a.id,
  boutiqueId: a.boutiqueId,
  fournisseurId: a.fournisseurId,
  numero: a.numero,
  statut: a.statut,
  dateAchat: a.dateAchat.toISOString().slice(0, 10),
  montantTotal: nombre(a.montantTotal),
  montantPaye: nombre(a.montantPaye),
  note: a.note,
});

export const versLigneAchat = (l: LigneAchat): LigneAchatSync => ({
  id: l.id,
  achatId: l.achatId,
  produitId: l.produitId,
  quantite: l.quantite,
  quantiteRecue: l.quantiteRecue,
  prixAchat: nombre(l.prixAchat),
});

/** Les vendeurs ne reçoivent ni les prix d'achat (marges du commerce) ni les fournisseurs et achats. */
export function masquerPourRole<E extends EntiteSync>(
  entite: E,
  donnees: DonneesEntites[E] | null,
  role: Role,
): DonneesEntites[E] | null {
  if (!donnees || role !== Role.VENDEUR) return donnees;
  // Les fournisseurs (achats, dettes) ne concernent que le propriétaire et les gérants.
  if (entite === 'fournisseur' || entite === 'achat' || entite === 'ligneAchat') return null;
  if (entite === 'produit' || entite === 'prixBoutique' || entite === 'article') {
    return { ...donnees, prixAchat: null };
  }
  return donnees;
}
