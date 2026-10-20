import type { BaseSql } from './base/sql';
import type { ArticlePanier } from './panier';

/** Lectures de la base locale pour l'écran de vente. */

interface LigneProduit {
  id: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  modeleId: string | null;
  prixDetail: number;
  prixGros: number;
  seuilGros: number | null;
  quantite: number;
}

const SELECT_PRODUIT = `
  SELECT p.id, p.nom, p.type, p.modeleId, p.seuilGros,
         COALESCE(pb.prixDetail, p.prixDetail) AS prixDetail,
         COALESCE(pb.prixGros, p.prixGros) AS prixGros,
         COALESCE(s.quantite, 0) AS quantite
    FROM produit p
    LEFT JOIN prixBoutique pb ON pb.produitId = p.id AND pb.boutiqueId = ?
    LEFT JOIN stock s ON s.produitId = p.id AND s.boutiqueId = ?`;

/** Produit avec les prix de la boutique, prêt à mettre au panier. */
export async function produitPourVente(base: BaseSql, boutiqueId: string, produitId: string) {
  return base.premier<LigneProduit>(`${SELECT_PRODUIT} WHERE p.id = ?`, [
    boutiqueId,
    boutiqueId,
    produitId,
  ]);
}

/** Téléphone choisi ; `prixRevente` : prix propre d'un téléphone revendu d'occasion. */
export interface ArticleChoisi {
  id: string;
  imei: string;
  prixRevente: number | null;
}

export function versPanier(
  p: LigneProduit,
  cle: string,
  article: ArticleChoisi | null,
): ArticlePanier {
  const occasion = article?.prixRevente ?? null;
  return {
    cle,
    produitId: p.id,
    nom: p.nom,
    type: p.type,
    articleId: article?.id ?? null,
    imei: article?.imei ?? null,
    modeleId: p.modeleId,
    quantite: 1,
    prixDetail: occasion ?? p.prixDetail,
    prixGros: occasion ?? p.prixGros,
    seuilGros: occasion === null ? p.seuilGros : null,
    occasion: occasion !== null,
  };
}

/** Téléphones disponibles d'un produit dans la boutique (hors ceux déjà au panier). */
export function imeisDisponibles(
  base: BaseSql,
  boutiqueId: string,
  produitId: string,
  exclus: string[],
) {
  return base.tous<ArticleChoisi>(
    `SELECT id, imei, prixRevente FROM article
      WHERE produitId = ? AND boutiqueId = ? AND statut = 'EN_STOCK'
        ${exclus.length ? `AND id NOT IN (${exclus.map(() => '?').join(', ')})` : ''}
      ORDER BY imei LIMIT 100`,
    [produitId, boutiqueId, ...exclus],
  );
}

/** Téléphone en stock dans la boutique, par son identifiant. */
export function articleEnStock(base: BaseSql, boutiqueId: string, articleId: string) {
  return base.premier<ArticleChoisi & { produitId: string }>(
    "SELECT id, imei, prixRevente, produitId FROM article WHERE id = ? AND boutiqueId = ? AND statut = 'EN_STOCK'",
    [articleId, boutiqueId],
  );
}

/** Accessoires compatibles avec les téléphones du panier, en stock et pas encore ajoutés. */
export async function accessoiresCompatibles(
  base: BaseSql,
  boutiqueId: string,
  modeleIds: string[],
  dejaAuPanier: string[],
) {
  if (!modeleIds.length) return [];
  return base.tous<LigneProduit>(
    `${SELECT_PRODUIT}
      WHERE p.archive = 0 AND p.type = 'ACCESSOIRE' AND COALESCE(s.quantite, 0) > 0
        AND p.id IN (SELECT accessoireId FROM compatibilite WHERE modeleId IN (${modeleIds.map(() => '?').join(', ')}))
        ${dejaAuPanier.length ? `AND p.id NOT IN (${dejaAuPanier.map(() => '?').join(', ')})` : ''}
      ORDER BY p.nom LIMIT 6`,
    [boutiqueId, boutiqueId, ...modeleIds, ...dejaAuPanier],
  );
}
