import { z } from 'zod';
import type { Role } from './roles.js';

/** Ventes au détail et en gros : prix appliqués, remises, paiements, garantie. */

/** Moyens d'encaissement et de remboursement (argent réel). */
export const MOYENS_REMBOURSEMENT = ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'VIREMENT'] as const;
export type MoyenRemboursement = (typeof MOYENS_REMBOURSEMENT)[number];

/** Paiement d'une vente : argent réel, ou avoir du client (crédit laissé par un retour). */
export const MOYENS_PAIEMENT = [...MOYENS_REMBOURSEMENT, 'AVOIR'] as const;
export type MoyenPaiement = (typeof MOYENS_PAIEMENT)[number];

export const LIBELLES_MOYENS: Record<MoyenPaiement, string> = {
  ESPECES: 'Espèces',
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN MoMo',
  VIREMENT: 'Virement',
  AVOIR: 'Avoir',
};

/** Ces moyens laissent une trace : la référence de la transaction est exigée. */
export const moyenAvecReference = (moyen: MoyenPaiement) =>
  moyen !== 'ESPECES' && moyen !== 'AVOIR';

const montant = z.number().int('Montant entier attendu.').min(0);

export const schemaVente = z.object({
  id: z.uuid(),
  /** Numéro de facture donné par l'appareil, unique dans la boutique. */
  numero: z.string().trim().min(3).max(40),
  dateVente: z.iso.datetime({ offset: true }),
  clientId: z.uuid().nullable(),
  lignes: z
    .array(
      z.object({
        id: z.uuid(),
        produitId: z.uuid(),
        /** Téléphone vendu (nul pour un accessoire). */
        articleId: z.uuid().nullable(),
        quantite: z.number().int().min(1).max(10_000),
        tarif: z.enum(['DETAIL', 'GROS']),
        prixUnitaire: montant,
      }),
    )
    .min(1, 'Le panier est vide.')
    .max(500),
  /** Remise sur l'ensemble de la vente (montant). */
  remise: montant,
  paiements: z
    .array(
      z.object({
        id: z.uuid(),
        moyen: z.enum(MOYENS_PAIEMENT),
        montant: montant.min(1),
        reference: z.string().trim().max(60).nullable(),
      }),
    )
    .min(1, 'Indiquez le paiement.')
    .max(4),
  /** Jeton signé par le serveur quand un gérant a validé une remise au-delà du plafond. */
  autorisationRemise: z.string().max(2000).nullable(),
});
export type VenteSaisie = z.infer<typeof schemaVente>;

export const schemaAnnulationVente = z.object({
  venteId: z.uuid(),
  motif: z.string().trim().min(3, 'Motif obligatoire.').max(200),
});

export interface PrixProduit {
  prixDetail: number;
  prixGros: number;
  seuilGros: number | null;
}

/**
 * Prix de gros pour un client grossiste, ou dès que la quantité du produit dans le
 * panier atteint son seuil de gros ; sinon prix de détail.
 */
export function tarifApplicable(
  produit: PrixProduit,
  quantiteDuProduit: number,
  clientGrossiste: boolean,
): { tarif: 'DETAIL' | 'GROS'; prixUnitaire: number } {
  const gros =
    clientGrossiste || (produit.seuilGros !== null && quantiteDuProduit >= produit.seuilGros);
  return gros
    ? { tarif: 'GROS', prixUnitaire: produit.prixGros }
    : { tarif: 'DETAIL', prixUnitaire: produit.prixDetail };
}

/** Plafond de remise (en %) que ce rôle accorde seul. */
export function plafondRemise(
  role: Role,
  parametres: { remiseMaxVendeur: number; remiseMaxGerant: number },
): number {
  if (role === 'PROPRIETAIRE') return 100;
  return role === 'GERANT' ? parametres.remiseMaxGerant : parametres.remiseMaxVendeur;
}

/** Remise en pourcentage du sous-total (arrondie au centième). */
export const pourcentageRemise = (remise: number, sousTotal: number) =>
  sousTotal === 0 ? 0 : Math.round((remise / sousTotal) * 10_000) / 100;

/** Totaux de la vente. */
export function totauxVente(lignes: { quantite: number; prixUnitaire: number }[], remise: number) {
  const sousTotal = lignes.reduce((t, l) => t + l.quantite * l.prixUnitaire, 0);
  return { sousTotal, remise, total: sousTotal - remise };
}

/**
 * Contrôle de la remise : jamais plus que le sous-total ; au-delà du plafond du
 * vendeur, l'autorisation d'un gérant (dont le plafond couvre la remise) est exigée.
 */
export function erreurRemise(
  remise: number,
  sousTotal: number,
  plafondVendeur: number,
  plafondAutorise: number | null,
): string | null {
  if (remise > sousTotal) return 'La remise dépasse le montant de la vente.';
  const pourcentage = pourcentageRemise(remise, sousTotal);
  if (pourcentage <= plafondVendeur) return null;
  if (plafondAutorise === null) {
    return `Remise de ${pourcentage} % : au-delà de ${plafondVendeur} %, un gérant doit la valider.`;
  }
  if (pourcentage > plafondAutorise) {
    return `Remise de ${pourcentage} % : au-delà de ce que le gérant peut accorder (${plafondAutorise} %).`;
  }
  return null;
}

/**
 * Paiements d'une vente au comptant : la somme couvre le total ; la monnaie se rend
 * seulement sur les espèces ; les autres moyens portent une référence.
 * Renvoie le rendu de monnaie, ou le motif du refus.
 */
export function controlerPaiements(
  total: number,
  paiements: { moyen: MoyenPaiement; montant: number; reference: string | null }[],
): { ok: true; rendu: number } | { ok: false; motif: string } {
  for (const p of paiements) {
    if (moyenAvecReference(p.moyen) && !p.reference?.trim()) {
      return {
        ok: false,
        motif: `${LIBELLES_MOYENS[p.moyen]} : saisissez la référence de la transaction.`,
      };
    }
  }
  const paye = paiements.reduce((t, p) => t + p.montant, 0);
  if (paye < total) return { ok: false, motif: `Il manque ${total - paye} pour régler la vente.` };
  const rendu = paye - total;
  const especes = paiements.filter((p) => p.moyen === 'ESPECES').reduce((t, p) => t + p.montant, 0);
  if (rendu > especes) {
    return {
      ok: false,
      motif: 'La monnaie ne se rend que sur les espèces : ajustez les montants.',
    };
  }
  return { ok: true, rendu };
}

/** Fin de garantie : date de vente + durée du produit (nul sans garantie). */
export function finGarantie(dateVente: Date, garantieMois: number): Date | null {
  if (garantieMois <= 0) return null;
  const fin = new Date(dateVente);
  fin.setUTCMonth(fin.getUTCMonth() + garantieMois);
  return fin;
}

/**
 * Numéro de facture donné hors ligne sans collision : préfixe de la boutique,
 * code de l'appareil, numéro d'ordre propre à l'appareil (MAD-3F2A9C-000042).
 */
export function numeroFacture(prefixeBoutique: string, appareilId: string, ordre: number): string {
  const appareil = appareilId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${prefixeBoutique}-${appareil}-${String(ordre).padStart(6, '0')}`;
}
