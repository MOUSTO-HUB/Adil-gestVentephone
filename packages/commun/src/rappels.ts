import { z } from 'zod';
import { joursEntre, resteEcheance } from './credit.js';

/**
 * Rappels des tranches de crédit et pénalités de retard : règles pures, appliquées
 * chaque jour par le serveur (9 h, heure de la boutique) et affichées sur les fiches.
 */

/** Une relance de retard tous les 7 jours. */
export const INTERVALLE_RELANCE_JOURS = 7;

export const TYPES_PENALITE = ['FIXE', 'POURCENTAGE'] as const;
export type TypePenalite = (typeof TYPES_PENALITE)[number];

export interface ParametresRappels {
  /** Rappel N jours avant l'échéance (0 : pas de rappel avant). */
  joursAvant: number;
  /** Nombre maximal de relances de retard par tranche. */
  relancesMax: number;
  canal: 'SMS' | 'WHATSAPP';
  penaliteActive: boolean;
  penaliteType: TypePenalite;
  /** Montant fixe, ou pourcentage de la tranche. */
  penaliteValeur: number;
  /** Jours de retard tolérés avant la pénalité. */
  penaliteGrace: number;
}

export const PARAMETRES_RAPPELS_DEFAUT: ParametresRappels = {
  joursAvant: 3,
  relancesMax: 4,
  canal: 'SMS',
  penaliteActive: false,
  penaliteType: 'FIXE',
  penaliteValeur: 0,
  penaliteGrace: 3,
};

export const schemaParametresRappels = z
  .object({
    joursAvant: z.number().int().min(0).max(30),
    relancesMax: z.number().int().min(0).max(20),
    canal: z.enum(['SMS', 'WHATSAPP']),
    penaliteActive: z.boolean(),
    penaliteType: z.enum(TYPES_PENALITE),
    penaliteValeur: z.number().int().min(0),
    penaliteGrace: z.number().int().min(0).max(90),
  })
  .refine((p) => p.penaliteType !== 'POURCENTAGE' || p.penaliteValeur <= 100, {
    message: 'Pénalité : 100 % au plus.',
  })
  .refine((p) => !p.penaliteActive || p.penaliteValeur > 0, {
    message: 'Indiquez le montant ou le pourcentage de la pénalité.',
  });

export interface EcheanceRappel {
  numero: number;
  /** AAAA-MM-JJ. */
  dateEcheance: string;
  montant: number;
  montantPaye: number;
  penalite: number;
  /** Jour (AAAA-MM-JJ) du dernier rappel envoyé pour cette tranche, ou null. */
  dernierRappel: string | null;
  nombreRelances: number;
}

export type TypeRappel = 'AVANT' | 'JOUR' | 'RETARD';

export const LIBELLES_RAPPELS: Record<TypeRappel, string> = {
  AVANT: 'Rappel avant l’échéance',
  JOUR: 'Rappel le jour de l’échéance',
  RETARD: 'Relance de retard',
};

export interface RappelDu {
  type: TypeRappel;
  /** Tranche visée (la plus ancienne en retard pour une relance). */
  numero: number;
  dateEcheance: string;
  /** Montant rappelé : la tranche, ou tout l'échu pour une relance. */
  montant: number;
}

/**
 * Rappel à envoyer aujourd'hui pour un crédit, ou null. Un seul message par crédit et
 * par jour : relance de retard d'abord (toutes les tranches échues), sinon rappel du
 * jour, sinon rappel avant l'échéance (rattrapé si la tâche n'a pas tourné le jour même).
 */
export function rappelDu(
  echeances: EcheanceRappel[],
  aujourdhui: string,
  p: Pick<ParametresRappels, 'joursAvant' | 'relancesMax'>,
): RappelDu | null {
  const ouvertes = [...echeances]
    .sort((a, b) => a.numero - b.numero)
    .filter((e) => resteEcheance(e) > 0);
  // Déjà un rappel aujourd'hui pour ce crédit : rien de plus.
  if (ouvertes.some((e) => e.dernierRappel === aujourdhui)) return null;

  const echues = ouvertes.filter((e) => e.dateEcheance < aujourdhui);
  if (echues.length) {
    const plusAncienne = echues[0];
    const relances = Math.max(...echues.map((e) => e.nombreRelances));
    const dernier = echues
      .map((e) => e.dernierRappel)
      .filter((d): d is string => d !== null && d > plusAncienne.dateEcheance)
      .sort()
      .pop();
    const attente = dernier ? joursEntre(dernier, aujourdhui) >= INTERVALLE_RELANCE_JOURS : true;
    if (relances < p.relancesMax && attente) {
      return {
        type: 'RETARD',
        numero: plusAncienne.numero,
        dateEcheance: plusAncienne.dateEcheance,
        montant: echues.reduce((t, e) => t + resteEcheance(e), 0),
      };
    }
    return null;
  }

  const prochaine = ouvertes[0];
  if (!prochaine) return null;
  const dejaRappelee = (depuis: string) =>
    prochaine.dernierRappel !== null && prochaine.dernierRappel >= depuis;
  if (prochaine.dateEcheance === aujourdhui && !dejaRappelee(aujourdhui)) {
    return { type: 'JOUR', ...cible(prochaine) };
  }
  if (p.joursAvant > 0) {
    const restants = joursEntre(aujourdhui, prochaine.dateEcheance);
    if (restants > 0 && restants <= p.joursAvant) {
      // Rappel avant : envoyé une fois, dès l'ouverture de la fenêtre (ou au premier jour où la tâche tourne).
      if (!dejaRappelee(ajouterJours(prochaine.dateEcheance, -p.joursAvant))) {
        return { type: 'AVANT', ...cible(prochaine) };
      }
    }
  }
  return null;
}

const ajouterJours = (jour: string, n: number) =>
  new Date(Date.parse(`${jour}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const cible = (e: EcheanceRappel) => ({
  numero: e.numero,
  dateEcheance: e.dateEcheance,
  montant: resteEcheance(e),
});

/** Effet d'un rappel envoyé sur les tranches (dernier rappel, compteur de relances). */
export function apresRappel(
  echeances: EcheanceRappel[],
  rappel: RappelDu,
  aujourdhui: string,
): EcheanceRappel[] {
  return echeances.map((e) => {
    const visee =
      rappel.type === 'RETARD'
        ? resteEcheance(e) > 0 && e.dateEcheance < aujourdhui
        : e.numero === rappel.numero;
    if (!visee) return e;
    return {
      ...e,
      dernierRappel: aujourdhui,
      nombreRelances: e.nombreRelances + (rappel.type === 'RETARD' ? 1 : 0),
    };
  });
}

/**
 * Prochain rappel prévu (si rien n'est payé d'ici là) : premier jour, dans l'année, où
 * la tâche quotidienne enverra un rappel. Null si aucun rappel n'est prévu.
 */
export function prochainRappel(
  echeances: EcheanceRappel[],
  aujourdhui: string,
  p: Pick<ParametresRappels, 'joursAvant' | 'relancesMax'>,
): { jour: string; rappel: RappelDu } | null {
  for (let i = 0; i <= 366; i++) {
    const jour = ajouterJours(aujourdhui, i);
    const rappel = rappelDu(echeances, jour, p);
    if (rappel) return { jour, rappel };
  }
  return null;
}

/**
 * Pénalité due pour une tranche aujourd'hui (0 si aucune) : une seule fois par tranche,
 * quand le retard dépasse le délai de grâce et que la pénalité est activée.
 */
export function penaliteDue(
  e: EcheanceRappel,
  aujourdhui: string,
  p: Pick<
    ParametresRappels,
    'penaliteActive' | 'penaliteType' | 'penaliteValeur' | 'penaliteGrace'
  >,
): number {
  if (!p.penaliteActive || e.penalite > 0 || resteEcheance(e) <= 0) return 0;
  if (joursEntre(e.dateEcheance, aujourdhui) <= p.penaliteGrace) return 0;
  return p.penaliteType === 'FIXE'
    ? p.penaliteValeur
    : Math.round((e.montant * p.penaliteValeur) / 100);
}
