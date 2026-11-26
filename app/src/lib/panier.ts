import {
  codeAppareil,
  numeroFacture,
  ordreFacture,
  tarifApplicable,
  totauxVente,
} from '@gestvente/commun';
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
  /** Prix de vente changé par le vendeur (sinon : prix du catalogue, détail ou gros). */
  prixManuel?: number | null;
}

export interface LignePrix extends ArticlePanier {
  tarif: 'DETAIL' | 'GROS';
  prixUnitaire: number;
  /** Prix du catalogue (détail ou gros) : référence d'un prix changé à la main. */
  prixCatalogue: number;
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
    const prixUnitaire = a.prixManuel ?? prix.prixUnitaire;
    return {
      ...a,
      tarif: prix.tarif,
      prixUnitaire,
      prixCatalogue: prix.prixUnitaire,
      total: prixUnitaire * a.quantite,
    };
  });
  return { lignes, ...totauxVente(lignes, remise) };
}

/**
 * Prix le plus bas qu'un vendeur peut saisir lui-même : le prix du catalogue moins son
 * plafond de remise (en %). Au-delà, il passe par une remise validée par le gérant. Un
 * prix plus haut que le catalogue est toujours possible. Chaque prix changé est noté au
 * journal par le serveur (« Vente à un prix différent »).
 */
export function prixMinimum(prixCatalogue: number, plafondPourcent: number): number {
  return Math.ceil((prixCatalogue * (100 - Math.min(100, Math.max(0, plafondPourcent)))) / 100);
}

/**
 * Prochain numéro de facture de cet appareil (compteur gardé dans la base locale) :
 * aucun échange avec le serveur, aucune collision entre appareils. Après une base
 * locale recréée (reconnexion), le compteur reprend après le plus grand numéro connu :
 * celui donné par le serveur à la connexion et ceux des ventes synchronisées.
 */
export async function prochainNumeroFacture(
  base: BaseSql,
  prefixeBoutique: string,
  appareilId: string,
  dernierConnu = 0,
): Promise<string> {
  const cle = `ordre-facture:${appareilId}`;
  const compteur = await lireMeta(base, cle);
  // Compteur perdu (base locale recréée) : on repart des factures connues de l'appareil.
  // Sinon il suffit : pas de lecture de toutes les ventes à chaque encaissement.
  const ventes =
    compteur === null
      ? await base.tous<{ numero: string }>('SELECT numero FROM vente WHERE numero LIKE ?', [
          `%-${codeAppareil(appareilId)}-%`,
        ])
      : [];
  const ordre =
    Math.max(
      Number(compteur ?? '0'),
      dernierConnu,
      ...ventes.map((v) => ordreFacture(v.numero) ?? 0),
    ) + 1;
  await ecrireMeta(base, cle, String(ordre));
  return numeroFacture(prefixeBoutique, appareilId, ordre);
}
