import { z } from 'zod';
import { MOYENS_REMBOURSEMENT, type MoyenPaiement, type MoyenRemboursement } from './ventes.js';

/**
 * Caisse : session journalière d'un vendeur (fond de caisse, ventes, remboursements,
 * dépenses), clôture par comptage de chaque moyen de paiement, écart et validation.
 */

export const CATEGORIES_DEPENSE = [
  'LOYER',
  'ELECTRICITE',
  'TRANSPORT',
  'SALAIRE',
  'ENTRETIEN',
  'AUTRE',
] as const;
export type CategorieDepense = (typeof CATEGORIES_DEPENSE)[number];
export const LIBELLES_CATEGORIES_DEPENSE: Record<CategorieDepense, string> = {
  LOYER: 'Loyer',
  ELECTRICITE: 'Électricité',
  TRANSPORT: 'Transport',
  SALAIRE: 'Salaire',
  ENTRETIEN: 'Entretien',
  AUTRE: 'Autre',
};

/** Montants par moyen de paiement réel (l'avoir n'est pas de l'argent en caisse). */
export type Montants = Record<MoyenRemboursement, number>;
export const montantsVides = (): Montants => ({
  ESPECES: 0,
  ORANGE_MONEY: 0,
  MTN_MOMO: 0,
  VIREMENT: 0,
});
const somme = (m: Montants) => MOYENS_REMBOURSEMENT.reduce((t, k) => t + m[k], 0);

const montant = z.number().int('Montant entier attendu.').min(0);

export const schemaOuvertureCaisse = z.object({
  id: z.uuid(),
  ouverteLe: z.iso.datetime({ offset: true }),
  fondInitial: montant,
});

export const schemaClotureCaisse = z.object({
  caisseId: z.uuid(),
  clotureeLe: z.iso.datetime({ offset: true }),
  comptage: z.object({
    ESPECES: montant,
    ORANGE_MONEY: montant,
    MTN_MOMO: montant,
    VIREMENT: montant,
  }),
  commentaire: z.string().trim().max(500).nullable(),
});

export const schemaValidationCaisse = z.object({
  caisseId: z.uuid(),
  commentaire: z.string().trim().max(500).nullable(),
});

export const schemaDepense = z.object({
  id: z.uuid(),
  dateDepense: z.iso.datetime({ offset: true }),
  categorie: z.enum(CATEGORIES_DEPENSE),
  libelle: z.string().trim().min(2, 'Décrivez la dépense.').max(120),
  montant: montant.min(1, 'Montant de la dépense ?'),
  moyen: z.enum(MOYENS_REMBOURSEMENT),
  /** Caisse d'où sort l'argent (nul : payée hors caisse, par le propriétaire par exemple). */
  caisseId: z.uuid().nullable(),
});

/** Ce qui est passé par la caisse pendant la session. */
export interface MouvementsCaisse {
  fondInitial: number;
  ventes: {
    statut: 'VALIDEE' | 'ANNULEE';
    renduMonnaie: number;
    paiements: { moyen: MoyenPaiement; montant: number }[];
  }[];
  retours: { montantRembourse: number; moyenRemboursement: MoyenRemboursement | null }[];
  depenses: { montant: number; moyen: MoyenRemboursement }[];
  /** Tranches de crédit encaissées dans la session. */
  encaissements?: { montant: number; moyen: MoyenRemboursement }[];
}

/** Totaux de la session : encaissé, remboursé, dépensé, attendu, par moyen. */
export function bilanCaisse(m: MouvementsCaisse) {
  const encaisse = montantsVides();
  const rembourse = montantsVides();
  const depense = montantsVides();
  let nombreVentes = 0;
  for (const v of m.ventes) {
    if (v.statut !== 'VALIDEE') continue;
    nombreVentes++;
    for (const p of v.paiements) if (p.moyen !== 'AVOIR') encaisse[p.moyen] += p.montant;
    // La monnaie rendue sort des espèces.
    encaisse.ESPECES -= v.renduMonnaie;
  }
  for (const r of m.retours) {
    if (r.montantRembourse > 0 && r.moyenRemboursement) {
      rembourse[r.moyenRemboursement] += r.montantRembourse;
    }
  }
  for (const d of m.depenses) depense[d.moyen] += d.montant;
  for (const e of m.encaissements ?? []) encaisse[e.moyen] += e.montant;
  const theorique = montantsVides();
  for (const k of MOYENS_REMBOURSEMENT) {
    theorique[k] = (k === 'ESPECES' ? m.fondInitial : 0) + encaisse[k] - rembourse[k] - depense[k];
  }
  return { nombreVentes, encaisse, rembourse, depense, theorique };
}

/** Écart par moyen : compté − attendu (négatif = il manque de l'argent). */
export function ecartsCaisse(theorique: Montants, comptage: Montants) {
  const parMoyen = montantsVides();
  for (const k of MOYENS_REMBOURSEMENT) parMoyen[k] = comptage[k] - theorique[k];
  return { parMoyen, total: somme(comptage) - somme(theorique) };
}

/** Un écart, même compensé d'un moyen à l'autre, doit être expliqué. */
export function erreurCloture(ecarts: Montants, commentaire: string | null): string | null {
  const avecEcart = MOYENS_REMBOURSEMENT.some((k) => ecarts[k] !== 0);
  if (avecEcart && (commentaire?.trim().length ?? 0) < 3) {
    return 'Écart constaté : expliquez-le en commentaire.';
  }
  return null;
}

export const totalMontants = somme;
