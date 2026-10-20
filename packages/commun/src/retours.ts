import { z } from 'zod';
import { MOYENS_PAIEMENT, MOYENS_REMBOURSEMENT, schemaVente } from './ventes.js';

/**
 * Retours et échanges : conditions (délai, état de l'appareil, garantie), valeur des
 * articles rendus, remboursement, avoir ou échange avec différence à payer ou à rendre.
 */

export const TYPES_RETOUR = ['REMBOURSEMENT', 'AVOIR', 'ECHANGE'] as const;
export type TypeRetour = (typeof TYPES_RETOUR)[number];
export const LIBELLES_TYPES_RETOUR: Record<TypeRetour, string> = {
  REMBOURSEMENT: 'Remboursement',
  AVOIR: 'Avoir',
  ECHANGE: 'Échange',
};

export const ETATS_RETOUR = ['INTACT', 'DEFECTUEUX', 'ENDOMMAGE'] as const;
export type EtatRetour = (typeof ETATS_RETOUR)[number];
export const LIBELLES_ETATS_RETOUR: Record<EtatRetour, string> = {
  INTACT: 'Intact',
  DEFECTUEUX: 'En panne',
  ENDOMMAGE: 'Endommagé par le client',
};

export const DESTINATIONS_RETOUR = ['REMISE_EN_STOCK', 'OCCASION', 'REBUT'] as const;
export type DestinationRetour = (typeof DESTINATIONS_RETOUR)[number];
export const LIBELLES_DESTINATIONS: Record<DestinationRetour, string> = {
  REMISE_EN_STOCK: 'En stock (neuf)',
  OCCASION: 'En stock (occasion)',
  REBUT: 'Au rebut',
};

const montant = z.number().int('Montant entier attendu.').min(0);

/** La vente de l'échange : réglée en partie par la valeur des articles rendus. */
export const schemaVenteEchange = schemaVente.extend({
  paiements: z
    .array(
      z.object({
        id: z.uuid(),
        moyen: z.enum(MOYENS_PAIEMENT),
        montant: montant.min(1),
        reference: z.string().trim().max(60).nullable(),
      }),
    )
    .max(4),
});

export type VenteEchangeSaisie = z.infer<typeof schemaVenteEchange>;

export const schemaRetour = z.object({
  id: z.uuid(),
  venteId: z.uuid(),
  dateRetour: z.iso.datetime({ offset: true }),
  type: z.enum(TYPES_RETOUR),
  etatAppareil: z.enum(ETATS_RETOUR),
  motif: z.string().trim().min(3, 'Indiquez le motif du retour.').max(300),
  lignes: z
    .array(
      z.object({
        id: z.uuid(),
        ligneVenteId: z.uuid(),
        quantite: z.number().int().min(1).max(10_000),
        destination: z.enum(DESTINATIONS_RETOUR),
        /** Prix de revente d'un téléphone remis en vente d'occasion. */
        prixRevente: montant.min(1).nullable(),
      }),
    )
    .min(1, 'Choisissez au moins un article rendu.')
    .max(200),
  /** Moyen de remboursement (remboursement, ou rendu de la différence d'un échange). */
  remboursement: z
    .object({
      moyen: z.enum(MOYENS_REMBOURSEMENT),
      reference: z.string().trim().max(60).nullable(),
    })
    .nullable(),
  /** Nouvelle vente d'un échange. */
  echange: schemaVenteEchange.nullable(),
  /** Jeton signé par le serveur quand un gérant a validé le retour d'un vendeur. */
  autorisation: z.string().max(2000).nullable(),
  /** Session de caisse d'où sort le remboursement. */
  caisseId: z.uuid().nullable().optional(),
});
export type RetourSaisi = z.infer<typeof schemaRetour>;

const JOUR_MS = 86_400_000;

/** Jours entamés depuis la vente (le jour même compte 0). */
export const joursDepuisVente = (dateVente: Date, dateRetour: Date) =>
  Math.max(0, Math.floor((dateRetour.getTime() - dateVente.getTime()) / JOUR_MS));

/**
 * Conditions du commerce : dans le délai, retour ou échange si l'appareil n'a pas
 * été endommagé par le client ; au-delà, seul un appareil en panne et encore sous
 * garantie s'échange. Renvoie le motif du refus, ou null.
 */
export function erreurConditionsRetour(c: {
  dateVente: Date;
  dateRetour: Date;
  delaiJours: number;
  etat: EtatRetour;
  type: TypeRetour;
  /** Tous les articles rendus sont encore sous garantie à la date du retour. */
  sousGarantie: boolean;
}): string | null {
  if (c.dateRetour.getTime() < c.dateVente.getTime()) return 'Retour daté avant la vente.';
  if (c.etat === 'ENDOMMAGE') {
    return 'Appareil endommagé par le client : ni retour ni échange.';
  }
  const jours = joursDepuisVente(c.dateVente, c.dateRetour);
  if (jours <= c.delaiJours) return null;
  if (c.etat === 'DEFECTUEUX' && c.sousGarantie && c.type === 'ECHANGE') return null;
  return `Vente d'il y a ${jours} jours (délai : ${c.delaiJours} jours) : seul un appareil en panne, encore sous garantie, peut être échangé.`;
}

/**
 * Valeur rendue pour `quantite` articles d'une ligne : le prix payé, remise de la
 * vente déduite au prorata (arrondie comme dans les rapports : un article rendu en entier annule exactement sa part de la vente).
 */
export function valeurRetour(
  ligne: { prixUnitaire: number },
  quantite: number,
  vente: { sousTotal: number; remise: number },
): number {
  if (vente.sousTotal <= 0) return 0;
  return Math.round(
    (ligne.prixUnitaire * quantite * (vente.sousTotal - vente.remise)) / vente.sousTotal,
  );
}

/**
 * Répartition de la valeur rendue selon le type de retour :
 * - remboursement : toute la valeur est rendue au client ;
 * - avoir : toute la valeur va au solde d'avoir du client ;
 * - échange : la valeur règle la nouvelle vente (`reprise`), le client paie le reste
 *   (`aPayer`) ou on lui rend l'excédent (`aRendre`).
 */
export function bilanRetour(
  type: TypeRetour,
  valeur: number,
  totalEchange: number,
): { aRendre: number; avoir: number; reprise: number; aPayer: number } {
  if (type === 'REMBOURSEMENT') return { aRendre: valeur, avoir: 0, reprise: 0, aPayer: 0 };
  if (type === 'AVOIR') return { aRendre: 0, avoir: valeur, reprise: 0, aPayer: 0 };
  const reprise = Math.min(valeur, totalEchange);
  return { aRendre: valeur - reprise, avoir: 0, reprise, aPayer: totalEchange - reprise };
}

/** Destination possible d'un article rendu. */
export function erreurDestination(
  type: 'TELEPHONE' | 'ACCESSOIRE',
  destination: DestinationRetour,
  prixRevente: number | null,
): string | null {
  if (destination === 'OCCASION') {
    if (type !== 'TELEPHONE') return 'Seul un téléphone se revend d’occasion.';
    if (!prixRevente) return 'Indiquez le prix de revente d’occasion.';
  } else if (prixRevente !== null) {
    return 'Le prix de revente ne concerne que la revente d’occasion.';
  }
  return null;
}

/** Quantité encore retournable d'une ligne de vente. */
export const quantiteRetournable = (vendue: number, dejaRendue: number) =>
  Math.max(0, vendue - dejaRendue);
