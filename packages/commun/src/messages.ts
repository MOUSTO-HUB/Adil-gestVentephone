import { z } from 'zod';

/**
 * Messages aux clients (SMS, WhatsApp) : modèles de textes à variables, limite des
 * SMS, paramètres des modèles WhatsApp approuvés. Les envois partent du serveur.
 */

export const CANAUX_MESSAGE = ['SMS', 'WHATSAPP'] as const;
export type CanalMessage = (typeof CANAUX_MESSAGE)[number];
export const LIBELLES_CANAUX: Record<CanalMessage, string> = { SMS: 'SMS', WHATSAPP: 'WhatsApp' };

export const TYPES_MESSAGE = [
  'FACTURE',
  'RECU',
  'RAPPEL_ECHEANCE',
  'RETARD_ECHEANCE',
  'AUTRE',
] as const;
export type TypeMessage = (typeof TYPES_MESSAGE)[number];
export const LIBELLES_TYPES_MESSAGE: Record<TypeMessage, string> = {
  FACTURE: 'Facture',
  RECU: 'Reçu',
  RAPPEL_ECHEANCE: 'Rappel d’échéance',
  RETARD_ECHEANCE: 'Échéance en retard',
  AUTRE: 'Autre',
};

export const STATUTS_MESSAGE = ['EN_ATTENTE', 'ENVOYE', 'DELIVRE', 'ECHEC'] as const;
export type StatutMessage = (typeof STATUTS_MESSAGE)[number];
export const LIBELLES_STATUTS_MESSAGE: Record<StatutMessage, string> = {
  EN_ATTENTE: 'En attente',
  ENVOYE: 'Envoyé',
  DELIVRE: 'Délivré',
  ECHEC: 'Échec',
};

export const VARIABLES_MESSAGE = [
  'client',
  'montant',
  'monnaie',
  'echeance',
  'boutique',
  'lien',
  'numero',
  'commerce',
] as const;
export type VariableMessage = (typeof VARIABLES_MESSAGE)[number];
export type Variables = Partial<Record<VariableMessage, string>>;

/** Taille maximale d'un SMS (un seul message, alphabet GSM). */
export const LONGUEUR_SMS = 160;

/** Textes par défaut ; le propriétaire peut les modifier (SMS). */
export const MODELES_PAR_DEFAUT: Record<TypeMessage, Record<CanalMessage, string>> = {
  FACTURE: {
    SMS: '{boutique} : merci {client} ! Facture {numero} : {montant} {monnaie}. Détail et garantie : {lien}',
    WHATSAPP:
      'Bonjour {client}, merci pour votre achat chez {boutique}. Facture {numero} : {montant} {monnaie}. Votre facture et votre garantie : {lien}',
  },
  RECU: {
    SMS: '{boutique} : reçu de {montant} {monnaie} pour la facture {numero}. Merci {client} ! {lien}',
    WHATSAPP:
      'Bonjour {client}, {boutique} a bien reçu {montant} {monnaie} pour la facture {numero}. Votre reçu : {lien}',
  },
  RAPPEL_ECHEANCE: {
    SMS: '{boutique} : bonjour {client}, rappel : {montant} {monnaie} à régler le {echeance}. Merci !',
    WHATSAPP:
      'Bonjour {client}, petit rappel de {boutique} : {montant} {monnaie} sont à régler le {echeance}. Merci !',
  },
  RETARD_ECHEANCE: {
    SMS: '{boutique} : {client}, l’échéance du {echeance} ({montant} {monnaie}) est en retard. Merci de passer régler.',
    WHATSAPP:
      'Bonjour {client}, l’échéance du {echeance} ({montant} {monnaie}) chez {boutique} est en retard. Merci de passer la régler.',
  },
  AUTRE: {
    SMS: '{boutique} : bonjour {client}.',
    WHATSAPP: 'Bonjour {client}, ici {boutique}.',
  },
};

/**
 * Paramètres des modèles WhatsApp approuvés par Meta, dans l'ordre {{1}}, {{2}}…
 * Le texte approuvé reprend celui de MODELES_PAR_DEFAUT (canal WHATSAPP).
 */
export const PARAMETRES_WHATSAPP: Record<TypeMessage, VariableMessage[]> = {
  FACTURE: ['client', 'boutique', 'numero', 'montant', 'monnaie', 'lien'],
  RECU: ['client', 'boutique', 'montant', 'monnaie', 'numero', 'lien'],
  RAPPEL_ECHEANCE: ['client', 'boutique', 'montant', 'monnaie', 'echeance'],
  RETARD_ECHEANCE: ['client', 'echeance', 'montant', 'monnaie', 'boutique'],
  AUTRE: ['client', 'boutique'],
};

/** Valeurs longues mais réalistes : un modèle doit tenir dans un SMS avec elles. */
export const EXEMPLE_VARIABLES: Record<VariableMessage, string> = {
  client: 'Mamadou Diallo',
  montant: '1 500 000',
  monnaie: 'GNF',
  echeance: '20/11/2026',
  boutique: 'Adil Phone Madina',
  lien: 'https://gestvente.exemple.com/api/f/Ab3dE9xK2q',
  numero: 'MAD-3F2A9C-000042',
  commerce: 'Adil Phone',
};

const VARIABLE = /\{(\w+)\}/g;

/** Remplace chaque {variable} par sa valeur (vide si absente). */
export function remplir(modele: string, variables: Variables): string {
  return modele
    .replace(VARIABLE, (_, nom: string) => variables[nom as VariableMessage] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Contrôle d'un texte saisi par le propriétaire. */
export function erreurModele(texte: string, canal: CanalMessage): string | null {
  if (!texte.trim()) return 'Le texte est vide.';
  const inconnues = [...texte.matchAll(VARIABLE)]
    .map((m) => m[1]!)
    .filter((v) => !VARIABLES_MESSAGE.includes(v as VariableMessage));
  if (inconnues.length) {
    return `Variable inconnue : {${inconnues[0]}}. Variables possibles : ${VARIABLES_MESSAGE.map((v) => `{${v}}`).join(', ')}.`;
  }
  if (canal === 'SMS') {
    const exemple = remplir(texte, EXEMPLE_VARIABLES);
    if (exemple.length > LONGUEUR_SMS) {
      return `Trop long pour un SMS : ${exemple.length} caractères avec des valeurs réelles (${LONGUEUR_SMS} au plus).`;
    }
  }
  return null;
}

/**
 * Texte d'un SMS : au besoin, le nom du client et de la boutique sont raccourcis,
 * puis le texte est coupé (le lien, s'il est à la fin, est gardé en priorité).
 */
export function texteSms(modele: string, variables: Variables): string {
  let texte = remplir(modele, variables);
  if (texte.length <= LONGUEUR_SMS) return texte;
  const courtes: Variables = {
    ...variables,
    client: variables.client?.split(' ')[0],
    boutique: variables.boutique?.slice(0, 15),
  };
  texte = remplir(modele, courtes);
  if (texte.length <= LONGUEUR_SMS) return texte;
  const lien = courtes.lien;
  if (lien && texte.endsWith(lien)) {
    const debut = texte.slice(0, texte.length - lien.length).trimEnd();
    return `${debut.slice(0, LONGUEUR_SMS - lien.length - 2)}… ${lien}`;
  }
  return `${texte.slice(0, LONGUEUR_SMS - 1)}…`;
}

/** Envoi demandé depuis l'appareil (même hors ligne) : il part quand l'opération arrive. */
export const schemaEnvoiMessage = z.object({
  id: z.uuid(),
  venteId: z.uuid(),
  type: z.enum(['FACTURE', 'RECU']),
  canal: z.enum(CANAUX_MESSAGE),
  /** Numéro saisi pour un client de passage (E.164) ; sinon celui du client de la vente. */
  telephone: z
    .string()
    .regex(/^\+\d{8,15}$/, 'Numéro au format international (+224…).')
    .nullable(),
});
