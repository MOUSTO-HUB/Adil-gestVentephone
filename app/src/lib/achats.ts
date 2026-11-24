import {
  type AchatSync,
  type DocumentBonCommande,
  type LigneAchatSync,
  prefixeBonCommande,
  prochainNumeroBon,
} from '@gestvente/commun';
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

/** Données du bon de commande imprimable, lues dans la base locale (hors ligne). */
export async function chargerBonCommande(
  base: BaseSql,
  achatId: string,
  entete: {
    commerce: string;
    boutique: { nom: string; adresse: string | null; telephone?: string | null };
    monnaie: string;
    emisPar: string | null;
  },
): Promise<DocumentBonCommande | null> {
  const achat = await base.premier<
    Omit<AchatSync, 'paiements'> & {
      paiements: string | null;
      fNom: string | null;
      fTelephone: string | null;
      fAdresse: string | null;
    }
  >(
    `SELECT a.*, f.nom AS fNom, f.telephone AS fTelephone, f.adresse AS fAdresse
       FROM achat a LEFT JOIN fournisseur f ON f.id = a.fournisseurId WHERE a.id = ?`,
    [achatId],
  );
  if (!achat) return null;
  const lignes = await lignesAchat(base, achatId);
  let paiements: AchatSync['paiements'] = [];
  try {
    paiements = achat.paiements ? (JSON.parse(achat.paiements) as AchatSync['paiements']) : [];
  } catch {
    paiements = [];
  }
  return {
    commerce: entete.commerce,
    boutique: {
      nom: entete.boutique.nom,
      adresse: entete.boutique.adresse,
      telephone: entete.boutique.telephone ?? null,
    },
    numero: achat.numero,
    dateAchat: achat.dateAchat,
    statut: achat.statut,
    fournisseur: {
      nom: achat.fNom ?? '?',
      telephone: achat.fTelephone,
      adresse: achat.fAdresse,
    },
    lignes: lignes.map((l) => ({
      designation: l.nom,
      quantite: l.quantite,
      quantiteRecue: l.quantiteRecue,
      prixAchat: l.prixAchat,
      total: l.quantite * l.prixAchat,
    })),
    total: achat.montantTotal,
    montantPaye: achat.montantPaye,
    paiements,
    note: achat.note,
    emisPar: entete.emisPar,
    monnaie: entete.monnaie,
  };
}

/** Prochain numéro de bon de l'utilisateur (BCAB-20260001), d'après les bons de l'appareil. */
export async function prochainNumeroAchat(base: BaseSql, nom: string, date: Date) {
  const annee = date.getFullYear();
  const existants = await base.tous<{ numero: string }>(
    'SELECT numero FROM achat WHERE numero LIKE ?',
    [`${prefixeBonCommande(nom, annee)}%`],
  );
  return prochainNumeroBon(
    nom,
    annee,
    existants.map((e) => e.numero),
  );
}
