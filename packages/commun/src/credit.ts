import { z } from 'zod';
import type { MoyenRemboursement } from './ventes.js';

/**
 * Vente à crédit : apport à la vente, reste remboursé par tranches hebdomadaires ou
 * mensuelles. Dates d'échéance en jours (AAAA-MM-JJ), au fuseau du commerce.
 */

export const FREQUENCES_CREDIT = ['HEBDOMADAIRE', 'MENSUELLE'] as const;
export type FrequenceCredit = (typeof FREQUENCES_CREDIT)[number];
export const LIBELLES_FREQUENCES: Record<FrequenceCredit, string> = {
  HEBDOMADAIRE: 'Chaque semaine',
  MENSUELLE: 'Chaque mois',
};

/** Nombre de tranches au plus (un an de semaines). */
export const TRANCHES_MAX = 52;

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
/** Moyens d'encaissement d'une tranche (argent réel) ; ventes.ts importe ce fichier. */
const MOYENS_ENCAISSEMENT = [
  'ESPECES',
  'ORANGE_MONEY',
  'MTN_MOMO',
  'VIREMENT',
] as const satisfies readonly MoyenRemboursement[];
const montant = z.number().int('Montant entier attendu.').min(0);

/** Jour (AAAA-MM-JJ) d'une date au fuseau donné. */
export function jourLocal(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Jour décalé de `n` semaines ou de `n` mois (le 31 devient le dernier jour du mois). */
export function decalerJour(jour: string, frequence: FrequenceCredit, n: number): string {
  const [a, m, j] = jour.split('-').map(Number);
  if (frequence === 'HEBDOMADAIRE') {
    return new Date(Date.UTC(a, m - 1, j + 7 * n)).toISOString().slice(0, 10);
  }
  const dernierJour = new Date(Date.UTC(a, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + n, Math.min(j, dernierJour))).toISOString().slice(0, 10);
}

/** Écart en jours entre deux jours AAAA-MM-JJ (b − a). */
export function joursEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface TrancheCalculee {
  numero: number;
  date: string;
  montant: number;
}

/**
 * Échéancier : tranches égales arrondies vers le bas, la dernière ajustée pour que la
 * somme tombe juste ; une tranche par semaine ou par mois à partir de la première.
 */
export function echeancier(
  finance: number,
  nombreTranches: number,
  frequence: FrequenceCredit,
  premiereEcheance: string,
): TrancheCalculee[] {
  const base = Math.floor(finance / nombreTranches);
  return Array.from({ length: nombreTranches }, (_, i) => ({
    numero: i + 1,
    date: decalerJour(premiereEcheance, frequence, i),
    montant: i === nombreTranches - 1 ? finance - base * (nombreTranches - 1) : base,
  }));
}

/** Première échéance proposée : dans une semaine ou dans un mois. */
export const premiereEcheanceParDefaut = (aujourdhui: string, frequence: FrequenceCredit) =>
  decalerJour(aujourdhui, frequence, 1);

/** Fiche complète exigée pour un crédit : téléphone, pièce d'identité, adresse. */
export function erreurFicheCredit(
  client: {
    nom: string;
    telephone: string;
    typePiece: string | null;
    numeroPiece: string | null;
    adresse: string | null;
  } | null,
): string | null {
  if (!client) return 'Crédit : choisissez ou créez la fiche du client.';
  const manque = [
    !client.telephone ? 'téléphone' : null,
    !client.typePiece || !client.numeroPiece?.trim() ? 'pièce d’identité' : null,
    !client.adresse?.trim() ? 'adresse' : null,
  ].filter(Boolean);
  return manque.length
    ? `Crédit : complétez la fiche de ${client.nom} (${manque.join(', ')}).`
    : null;
}

/** Plafond : l'encours du client et le nouveau crédit ne le dépassent pas. */
export function erreurPlafondCredit(
  plafond: number | null,
  encours: number,
  nouveau: number,
): string | null {
  if (plafond === null || plafond <= 0) {
    return 'Ce client n’a pas de plafond de crédit : le propriétaire doit le fixer sur sa fiche.';
  }
  if (encours + nouveau > plafond) {
    return `Plafond de crédit dépassé : encours ${encours} + nouveau crédit ${nouveau} > plafond ${plafond}.`;
  }
  return null;
}

/** Contrôles de la saisie : apport et tranches. */
export function erreurConditionsCredit(
  total: number,
  apport: number,
  nombreTranches: number,
): string | null {
  if (apport >= total) return 'L’apport couvre tout : faites une vente au comptant.';
  if (nombreTranches < 1 || nombreTranches > TRANCHES_MAX) {
    return `Nombre de tranches : de 1 à ${TRANCHES_MAX}.`;
  }
  if (total - apport < nombreTranches) return 'Trop de tranches pour ce montant.';
  return null;
}

export interface EcheanceSituation {
  numero: number;
  dateEcheance: string;
  montant: number;
  montantPaye: number;
  penalite: number;
}

export const resteEcheance = (e: EcheanceSituation) => e.montant + e.penalite - e.montantPaye;

/**
 * Répartition d'un encaissement sur les tranches, de la plus ancienne à la plus
 * récente (paiement partiel possible). Refusé au-delà du reste dû.
 */
export function repartirEncaissement(
  echeances: EcheanceSituation[],
  montantVerse: number,
): { ok: true; parts: { numero: number; montant: number }[] } | { ok: false; motif: string } {
  const du = echeances.reduce((t, e) => t + Math.max(0, resteEcheance(e)), 0);
  if (montantVerse <= 0) return { ok: false, motif: 'Montant de l’encaissement ?' };
  if (montantVerse > du) {
    return { ok: false, motif: `Le client ne doit plus que ${du} sur ce crédit.` };
  }
  let reste = montantVerse;
  const parts: { numero: number; montant: number }[] = [];
  for (const e of [...echeances].sort((a, b) => a.numero - b.numero)) {
    const part = Math.min(reste, Math.max(0, resteEcheance(e)));
    if (part > 0) parts.push({ numero: e.numero, montant: part });
    reste -= part;
    if (reste === 0) break;
  }
  return { ok: true, parts };
}

export type StatutAfficheCredit = 'EN_COURS' | 'EN_RETARD' | 'SOLDE' | 'ANNULE';

export const LIBELLES_STATUTS_CREDIT: Record<StatutAfficheCredit, string> = {
  EN_COURS: 'En cours',
  EN_RETARD: 'En retard',
  SOLDE: 'Soldé',
  ANNULE: 'Annulé',
};

/** Situation d'un crédit à une date : reste dû, retard, prochaine tranche. */
export function situationCredit(
  statut: 'EN_COURS' | 'SOLDE' | 'ANNULE',
  echeances: EcheanceSituation[],
  aujourdhui: string,
) {
  const ouvertes = [...echeances]
    .sort((a, b) => a.numero - b.numero)
    .filter((e) => resteEcheance(e) > 0);
  const restant = ouvertes.reduce((t, e) => t + resteEcheance(e), 0);
  const echues = ouvertes.filter((e) => e.dateEcheance < aujourdhui);
  const montantEchu = ouvertes
    .filter((e) => e.dateEcheance <= aujourdhui)
    .reduce((t, e) => t + resteEcheance(e), 0);
  const affiche: StatutAfficheCredit =
    statut !== 'EN_COURS' ? statut : echues.length ? 'EN_RETARD' : 'EN_COURS';
  return {
    restant,
    statut: affiche,
    /** Dû aujourd'hui (tranches échues ou du jour). */
    montantEchu,
    joursRetard: echues.length ? joursEntre(echues[0].dateEcheance, aujourdhui) : 0,
    tranchesEnRetard: echues.length,
    prochaine: ouvertes[0]
      ? {
          numero: ouvertes[0].numero,
          date: ouvertes[0].dateEcheance,
          reste: resteEcheance(ouvertes[0]),
        }
      : null,
  };
}

/** Crédit joint à une vente : apport (payé à la vente), tranches, garant. */
export const schemaCreditVente = z
  .object({
    id: z.uuid(),
    apport: montant,
    nombreTranches: z.number().int().min(1).max(TRANCHES_MAX),
    frequence: z.enum(FREQUENCES_CREDIT),
    premiereEcheance: z.string().regex(JOUR, 'Date de première échéance : AAAA-MM-JJ.'),
    garantId: z.uuid().nullable(),
    /** Identifiants des tranches, donnés par l'appareil (dans l'ordre). */
    echeanceIds: z.array(z.uuid()).min(1).max(TRANCHES_MAX),
  })
  .refine((c) => c.echeanceIds.length === c.nombreTranches, {
    message: 'Une tranche par identifiant.',
  })
  .refine((c) => new Set(c.echeanceIds).size === c.echeanceIds.length, {
    message: 'Identifiants de tranches en double.',
  });
export type CreditSaisi = z.infer<typeof schemaCreditVente>;

/** Encaissement d'une tranche (totale ou partielle), rattaché à la caisse du vendeur. */
export const schemaEncaissement = z.object({
  id: z.uuid(),
  creditId: z.uuid(),
  dateEncaissement: z.iso.datetime({ offset: true }),
  moyen: z.enum(MOYENS_ENCAISSEMENT),
  montant: montant.min(1, 'Montant de l’encaissement ?'),
  reference: z.string().trim().max(60).nullable(),
  caisseId: z.uuid().nullable(),
});
