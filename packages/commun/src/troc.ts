import { z } from 'zod';
import { imeiValide, normaliserImei } from './imei.js';
import type { Role } from './roles.js';

/**
 * Troc : reprise de l'ancien téléphone du client, déduite du prix du neuf.
 * Valeur proposée par la grille du commerce (modèle, capacité, état), sinon estimée
 * sur le prix du neuf ; le vendeur l'ajuste dans une limite, au-delà le gérant valide.
 */

export const ETATS_COMPOSANT = ['BON', 'MOYEN', 'MAUVAIS'] as const;
export type EtatComposant = (typeof ETATS_COMPOSANT)[number];

export const ETATS_REPRISE = ['EXCELLENT', 'BON', 'MOYEN', 'MAUVAIS'] as const;
export type EtatReprise = (typeof ETATS_REPRISE)[number];

export const LIBELLES_ETATS_COMPOSANT: Record<EtatComposant, string> = {
  BON: 'Bon',
  MOYEN: 'Moyen',
  MAUVAIS: 'Mauvais',
};

export const LIBELLES_ETATS_REPRISE: Record<EtatReprise, string> = {
  EXCELLENT: 'Excellent',
  BON: 'Bon',
  MOYEN: 'Moyen',
  MAUVAIS: 'Mauvais',
};

/** Ce que devient l'appareil repris : en réparation, ou en vente d'occasion. */
export const DESTINATIONS_REPRISE = ['A_REPARER', 'A_REVENDRE'] as const;
export type DestinationReprise = (typeof DESTINATIONS_REPRISE)[number];

export const LIBELLES_DESTINATIONS_REPRISE: Record<DestinationReprise, string> = {
  A_REPARER: 'À réparer',
  A_REVENDRE: 'À revendre (occasion)',
};

export const MOTIFS_IMEI_SIGNALE = ['VOLE', 'BLOQUE'] as const;
export type MotifImeiSignale = (typeof MOTIFS_IMEI_SIGNALE)[number];
export const LIBELLES_MOTIFS_IMEI: Record<MotifImeiSignale, string> = {
  VOLE: 'Volé',
  BLOQUE: 'Bloqué',
};

/** Photos de l'ancien téléphone (état constaté), envoyées après la synchronisation. */
export const PHOTOS_TROC_MAX = 4;

/** Limite par défaut (en %) au-dessus de la valeur proposée qu'un vendeur accorde seul. */
export const REPRISE_MAX_VENDEUR_DEFAUT = 10;

/**
 * État global à partir des composants : un appareil qui ne fonctionne pas ou dont un
 * composant est en mauvais état est « mauvais » ; tout bon, « excellent » ; un seul
 * composant moyen, « bon » ; plusieurs, « moyen ».
 */
export function etatGlobal(e: {
  ecran: EtatComposant;
  batterie: EtatComposant;
  boitier: EtatComposant;
  fonctionne: boolean;
}): EtatReprise {
  const composants = [e.ecran, e.batterie, e.boitier];
  if (!e.fonctionne || composants.includes('MAUVAIS')) return 'MAUVAIS';
  const moyens = composants.filter((c) => c === 'MOYEN').length;
  if (moyens === 0) return 'EXCELLENT';
  return moyens === 1 ? 'BON' : 'MOYEN';
}

/** Part du prix du neuf proposée sans grille, selon l'état. */
export const COEFFICIENTS_REPRISE: Record<EtatReprise, number> = {
  EXCELLENT: 0.6,
  BON: 0.5,
  MOYEN: 0.35,
  MAUVAIS: 0.15,
};

/** Arrondi des valeurs estimées (à 5 000 près, vers le bas). */
const PAS_ESTIMATION = 5_000;

export interface LigneGrille {
  modeleId: string;
  capacite: string | null;
  etat: EtatReprise;
  valeur: number;
}

/**
 * Valeur proposée : ligne de la grille pour ce modèle, cette capacité et cet état
 * (ou ce modèle toutes capacités), sinon estimation sur le prix du neuf.
 */
export function valeurProposee(
  grille: LigneGrille[],
  appareil: { modeleId: string | null; capacite: string | null; prixNeuf: number },
  etat: EtatReprise,
): { valeur: number; source: 'GRILLE' | 'ESTIMATION' } {
  const capacite = appareil.capacite?.trim().toLowerCase() ?? null;
  const lignes = grille.filter((l) => l.modeleId === appareil.modeleId && l.etat === etat);
  const exacte = lignes.find((l) => (l.capacite?.trim().toLowerCase() ?? null) === capacite);
  const generale = lignes.find((l) => l.capacite === null);
  const trouvee = (capacite !== null ? exacte : undefined) ?? generale;
  if (trouvee) return { valeur: trouvee.valeur, source: 'GRILLE' };
  const estimee = appareil.prixNeuf * COEFFICIENTS_REPRISE[etat];
  return {
    valeur: Math.floor(estimee / PAS_ESTIMATION) * PAS_ESTIMATION,
    source: 'ESTIMATION',
  };
}

/** Valeur la plus haute que ce rôle retient seul (le gérant et le propriétaire : sans limite). */
export function plafondReprise(proposee: number, role: Role, repriseMaxVendeur: number): number {
  if (role !== 'VENDEUR') return Number.POSITIVE_INFINITY;
  return Math.floor((proposee * (100 + repriseMaxVendeur)) / 100);
}

/**
 * Valeur retenue : baisser est toujours permis ; au-delà du plafond du vendeur, un
 * gérant valide (jusqu'à la valeur qu'il a acceptée).
 */
export function erreurReprise(
  retenue: number,
  plafondVendeur: number,
  valeurAutorisee: number | null,
): string | null {
  if (retenue <= plafondVendeur) return null;
  if (valeurAutorisee === null) {
    return `Reprise au-delà de ${plafondVendeur} : un gérant doit la valider avec son code PIN.`;
  }
  if (retenue > valeurAutorisee) {
    return `Reprise au-delà de la valeur validée par le gérant (${valeurAutorisee}).`;
  }
  return null;
}

/** Fiche client obligatoire pour un troc, avec sa pièce d'identité. */
export function erreurClientTroc(
  client: { typePiece: string | null; numeroPiece: string | null } | null,
): string | null {
  if (!client) return 'Troc : choisissez ou créez la fiche du client.';
  if (!client.typePiece || !client.numeroPiece?.trim()) {
    return 'Troc : enregistrez la pièce d’identité du client (type et numéro) sur sa fiche.';
  }
  return null;
}

const montant = z.number().int('Montant entier attendu.').min(0);

export const schemaTroc = z
  .object({
    id: z.uuid(),
    /** Article créé en stock pour l'appareil repris (identifiant donné par l'appareil). */
    articleId: z.uuid(),
    /** Produit (modèle et capacité) de l'appareil repris, dans le catalogue. */
    produitId: z.uuid(),
    imei: z
      .string()
      .transform(normaliserImei)
      .refine(imeiValide, 'IMEI de l’appareil repris invalide (15 chiffres).'),
    etatEcran: z.enum(ETATS_COMPOSANT),
    etatBatterie: z.enum(ETATS_COMPOSANT),
    etatBoitier: z.enum(ETATS_COMPOSANT),
    fonctionne: z.boolean(),
    /** Remarques (rayures, accessoires rendus, compte iCloud retiré…). */
    note: z.string().trim().max(300),
    valeurProposee: montant,
    valeurRetenue: montant.min(1, 'Indiquez la valeur de reprise.'),
    destination: z.enum(DESTINATIONS_REPRISE),
    /** Prix de revente d'occasion (obligatoire à la revente). */
    prixRevente: montant.min(1).nullable(),
    /** Jeton signé quand un gérant a validé une reprise au-delà de la limite du vendeur. */
    autorisation: z.string().max(2000).nullable(),
  })
  .refine((t) => t.destination !== 'A_REVENDRE' || t.prixRevente !== null, {
    message: 'Indiquez le prix de revente de l’appareil repris.',
  });
export type TrocSaisi = z.infer<typeof schemaTroc>;

/** Grille de reprise d'un modèle (et d'une capacité) : remplace ses lignes. */
export const schemaGrilleReprise = z.object({
  modeleId: z.uuid(),
  capacite: z.string().trim().max(20).nullable(),
  lignes: z
    .array(z.object({ id: z.uuid(), etat: z.enum(ETATS_REPRISE), valeur: montant.min(1) }))
    .max(ETATS_REPRISE.length)
    .refine((l) => new Set(l.map((x) => x.etat)).size === l.length, 'Un seul montant par état.'),
});

/** IMEI signalé volé ou bloqué (ou levée du signalement). */
export const schemaImeiSignale = z.object({
  id: z.uuid(),
  imei: z
    .string()
    .transform(normaliserImei)
    .refine((v) => /^\d{14,16}$/.test(v), 'IMEI : 14 à 16 chiffres.'),
  motif: z.enum(MOTIFS_IMEI_SIGNALE),
  note: z.string().trim().max(200).nullable(),
  actif: z.boolean(),
});

/** Remise en vente d'un appareil repris après réparation. */
export const schemaRemiseEnVente = z.object({
  articleId: z.uuid(),
  prixRevente: montant.min(1, 'Indiquez le prix de revente.'),
});
