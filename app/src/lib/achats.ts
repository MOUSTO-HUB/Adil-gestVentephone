import type { AchatSync, LigneAchatSync } from '@gestvente/commun';
import type { BaseSql } from './base/sql';

export interface AchatListe extends AchatSync {
  fournisseur: string;
}

export const LIBELLES_STATUTS_ACHAT: Record<AchatSync['statut'], string> = {
  BROUILLON: 'À réceptionner',
  PARTIEL: 'Reçu en partie',
  RECU: 'Reçu',
  ANNULE: 'Annulé',
};

/** Bons d'achat de la boutique, les plus récents d'abord. */
export function achatsDeLaBoutique(base: BaseSql, boutiqueId: string) {
  return base.tous<AchatListe>(
    `SELECT a.*, COALESCE(f.nom, '?') AS fournisseur FROM achat a
       LEFT JOIN fournisseur f ON f.id = a.fournisseurId
      WHERE a.boutiqueId = ? ORDER BY a.dateAchat DESC, a.numero DESC LIMIT 200`,
    [boutiqueId],
  );
}

export interface LigneDetaillee extends LigneAchatSync {
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
}

export function lignesAchat(base: BaseSql, achatId: string) {
  return base.tous<LigneDetaillee>(
    `SELECT l.*, p.nom, p.type FROM ligneAchat l JOIN produit p ON p.id = l.produitId
      WHERE l.achatId = ? ORDER BY p.nom`,
    [achatId],
  );
}

/**
 * Numéro de bon donné par l'appareil, hors ligne : préfixe de la boutique, date,
 * suffixe aléatoire (MAD-261020-K7Q2).
 */
export function numeroAchat(
  prefixe: string,
  date: Date,
  aleatoire: () => number = Math.random,
): string {
  const jour = date.toISOString().slice(2, 10).replace(/-/g, '');
  const lettres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const suffixe = Array.from(
    { length: 4 },
    () => lettres[Math.floor(aleatoire() * lettres.length)],
  ).join('');
  return `${prefixe}-${jour}-${suffixe}`;
}

/** Produits sous leur seuil d'alerte dans la boutique. */
export function produitsSousSeuil(base: BaseSql, boutiqueId: string) {
  return base.tous<{ id: string; nom: string; quantite: number; seuilMinimum: number }>(
    `SELECT p.id, p.nom, s.quantite, s.seuilMinimum FROM stock s JOIN produit p ON p.id = s.produitId
      WHERE s.boutiqueId = ? AND s.seuilMinimum > 0 AND s.quantite <= s.seuilMinimum AND p.archive = 0
      ORDER BY p.nom`,
    [boutiqueId],
  );
}
