import { numeroFacture, tarifApplicable, totauxVente } from '@gestvente/commun';
import { ecrireMeta, lireMeta } from './base/depot';
import type { BaseSql } from './base/sql';

/** Un article du panier : un téléphone (son IMEI) ou un accessoire (une quantité). */
export interface ArticlePanier {
  cle: string;
  produitId: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  articleId: string | null;
  imei: string | null;
  modeleId: string | null;
  quantite: number;
  prixDetail: number;
  prixGros: number;
  seuilGros: number | null;
  /** Téléphone revendu d'occasion (prix propre). */
  occasion?: boolean;
}

export interface LignePrix extends ArticlePanier {
  tarif: 'DETAIL' | 'GROS';
  prixUnitaire: number;
  total: number;
}

/**
 * Prix de chaque ligne : gros pour un client grossiste, ou dès que la quantité
 * totale du produit dans le panier atteint son seuil (plusieurs téléphones du même
 * modèle comptent ensemble).
 */
export function prixDuPanier(articles: ArticlePanier[], clientGrossiste: boolean, remise: number) {
  const parProduit = new Map<string, number>();
  for (const a of articles)
    parProduit.set(a.produitId, (parProduit.get(a.produitId) ?? 0) + a.quantite);
  const lignes: LignePrix[] = articles.map((a) => {
    const prix = tarifApplicable(a, parProduit.get(a.produitId) ?? 0, clientGrossiste);
    return { ...a, ...prix, total: prix.prixUnitaire * a.quantite };
  });
  return { lignes, ...totauxVente(lignes, remise) };
}

/**
 * Prochain numéro de facture de cet appareil (compteur gardé dans la base locale) :
 * aucun échange avec le serveur, aucune collision entre appareils.
 */
export async function prochainNumeroFacture(
  base: BaseSql,
  prefixeBoutique: string,
  appareilId: string,
): Promise<string> {
  const cle = `ordre-facture:${appareilId}`;
  const ordre = Number((await lireMeta(base, cle)) ?? '0') + 1;
  await ecrireMeta(base, cle, String(ordre));
  return numeroFacture(prefixeBoutique, appareilId, ordre);
}
