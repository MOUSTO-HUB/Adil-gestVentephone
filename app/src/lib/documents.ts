import type { DocumentVente, LargeurRecu, MoyenPaiement, VenteSync } from '@gestvente/commun';
import { lireMeta } from './base/depot';
import type { BaseSql } from './base/sql';

/** Fuseau des commerces de la V1 (Guinée) si le profil gardé ne le donne pas encore. */
export const FUSEAU_PAR_DEFAUT = 'Africa/Conakry';

/**
 * Données d'une facture ou d'un reçu lues dans la base locale : on imprime même
 * hors ligne, juste après l'encaissement.
 */
export async function chargerDocument(
  base: BaseSql,
  venteId: string,
  entete: {
    commerce: string;
    boutique: { nom: string; adresse: string | null; telephone?: string | null };
    monnaie: string;
    fuseau?: string;
  },
): Promise<DocumentVente | null> {
  const vente = await base.premier<
    VenteSync & { clientNom: string | null; clientTelephone: string | null }
  >(
    `SELECT v.*, c.nom AS clientNom, c.telephone AS clientTelephone
       FROM vente v LEFT JOIN client c ON c.id = v.clientId WHERE v.id = ?`,
    [venteId],
  );
  if (!vente) return null;
  const lignes = await base.tous<DocumentVente['lignes'][number]>(
    `SELECT p.nom AS designation, a.imei, l.quantite, l.tarif, l.prixUnitaire, l.total,
            p.garantieMois, l.finGarantie
       FROM ligneVente l JOIN produit p ON p.id = l.produitId LEFT JOIN article a ON a.id = l.articleId
      WHERE l.venteId = ? ORDER BY p.type DESC, p.nom`,
    [venteId],
  );
  const paiements = await base.tous<{
    moyen: MoyenPaiement;
    montant: number;
    reference: string | null;
  }>('SELECT moyen, montant, reference FROM paiementVente WHERE venteId = ? ORDER BY moyen', [
    venteId,
  ]);
  return {
    commerce: entete.commerce,
    boutique: {
      nom: entete.boutique.nom,
      adresse: entete.boutique.adresse,
      telephone: entete.boutique.telephone ?? null,
    },
    numero: vente.numero,
    dateVente: vente.dateVente,
    statut: vente.statut,
    client: vente.clientNom ? { nom: vente.clientNom, telephone: vente.clientTelephone } : null,
    lignes,
    sousTotal: vente.sousTotal,
    remise: vente.remise,
    total: vente.total,
    montantPaye: vente.montantPaye,
    renduMonnaie: vente.renduMonnaie,
    paiements,
    monnaie: entete.monnaie,
    fuseau: entete.fuseau ?? FUSEAU_PAR_DEFAUT,
  };
}

/** Réglages d'impression de cet appareil (gardés dans la base locale). */
export const CLES_IMPRESSION = {
  largeur: 'impression:largeur',
  imprimante: 'impression:imprimante',
} as const;

export interface ReglagesImpression {
  largeur: LargeurRecu;
  imprimante: { id: string; nom: string } | null;
}

export async function lireReglagesImpression(base: BaseSql): Promise<ReglagesImpression> {
  const largeur = (await lireMeta(base, CLES_IMPRESSION.largeur)) === '80' ? 80 : 58;
  const brut = await lireMeta(base, CLES_IMPRESSION.imprimante);
  let imprimante: ReglagesImpression['imprimante'] = null;
  try {
    imprimante = brut ? (JSON.parse(brut) as ReglagesImpression['imprimante']) : null;
  } catch {
    imprimante = null;
  }
  return { largeur, imprimante };
}
