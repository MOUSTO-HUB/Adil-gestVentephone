import type { LigneTransfertSync, TransfertSync } from '@gestvente/commun';
import type { ClientApi } from './api';
import { ecrireMeta, lireMeta } from './base/depot';
import type { BaseSql } from './base/sql';

export interface BoutiqueNom {
  id: string;
  nom: string;
}

const CLE_BOUTIQUES = 'boutiques:commerce';

/**
 * Boutiques du commerce (noms) : lues en ligne et gardées pour l'usage hors ligne ;
 * à défaut, celles du profil.
 */
export async function boutiquesDuCommerce(
  base: BaseSql,
  api: ClientApi,
  repli: BoutiqueNom[],
): Promise<BoutiqueNom[]> {
  try {
    const liste = await api.requete<BoutiqueNom[]>('/boutiques');
    await ecrireMeta(base, CLE_BOUTIQUES, JSON.stringify(liste));
    return liste;
  } catch {
    const gardee = await lireMeta(base, CLE_BOUTIQUES);
    return gardee ? (JSON.parse(gardee) as BoutiqueNom[]) : repli;
  }
}

export type FiltreTransferts = 'A_RECEVOIR' | 'A_PREPARER' | 'TOUS';

/** Transferts de la boutique (départ ou arrivée), les plus récents d'abord. */
export function listeTransferts(base: BaseSql, boutiqueId: string, filtre: FiltreTransferts) {
  const condition =
    filtre === 'A_RECEVOIR'
      ? "t.boutiqueArriveeId = ? AND t.statut = 'ENVOYE'"
      : filtre === 'A_PREPARER'
        ? "t.boutiqueDepartId = ? AND t.statut = 'DEMANDE'"
        : '(t.boutiqueDepartId = ?1 OR t.boutiqueArriveeId = ?1)';
  return base.tous<TransfertSync & { lignes: number; pieces: number }>(
    `SELECT t.*, COUNT(l.id) AS lignes, COALESCE(SUM(l.quantite), 0) AS pieces
       FROM transfert t LEFT JOIN ligneTransfert l ON l.transfertId = t.id
      WHERE ${condition}
      GROUP BY t.id ORDER BY t.creeLe DESC LIMIT 200`,
    [boutiqueId],
  );
}

export interface LigneDetail extends LigneTransfertSync {
  produit: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  /** Stock de la boutique de départ (préparation). */
  disponible: number;
}

export async function detailTransfert(base: BaseSql, id: string) {
  const transfert = await base.premier<TransfertSync>('SELECT * FROM transfert WHERE id = ?', [id]);
  if (!transfert) return null;
  const lignes = await base.tous<LigneDetail>(
    `SELECT l.*, COALESCE(p.nom, 'Produit') AS produit, COALESCE(p.type, 'ACCESSOIRE') AS type,
            COALESCE(s.quantite, 0) AS disponible
       FROM ligneTransfert l
       LEFT JOIN produit p ON p.id = l.produitId
       LEFT JOIN stock s ON s.produitId = l.produitId AND s.boutiqueId = ?
      WHERE l.transfertId = ? ORDER BY p.type DESC, p.nom`,
    [transfert.boutiqueDepartId, id],
  );
  return { transfert, lignes };
}

/** Téléphone en stock dans la boutique, retrouvé par son IMEI (préparation d'un envoi). */
export function telephoneEnStock(base: BaseSql, boutiqueId: string, imei: string) {
  return base.premier<{ id: string; produitId: string; produit: string }>(
    `SELECT a.id, a.produitId, p.nom AS produit FROM article a JOIN produit p ON p.id = a.produitId
      WHERE a.boutiqueId = ? AND a.statut = 'EN_STOCK' AND (a.imei = ? OR a.imei2 = ?)`,
    [boutiqueId, imei, imei],
  );
}
