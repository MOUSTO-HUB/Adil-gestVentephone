import { z } from 'zod';
import type { Role } from './roles.js';
import { telephoneValide } from './telephone.js';

/** Clients, garants et fournisseurs : règles partagées par l'API et l'application. */

export const TYPES_PIECES = ['CNI', 'PASSEPORT', 'PERMIS', 'CARTE_CONSULAIRE', 'AUTRE'] as const;
export type TypePiece = (typeof TYPES_PIECES)[number];

export const LIBELLES_PIECES: Record<TypePiece, string> = {
  CNI: 'Carte d’identité',
  PASSEPORT: 'Passeport',
  PERMIS: 'Permis de conduire',
  CARTE_CONSULAIRE: 'Carte consulaire',
  AUTRE: 'Autre pièce',
};

const telephone = z
  .string()
  .refine(
    telephoneValide,
    'Numéro de téléphone invalide (format international, ex. +224620112233).',
  );
const texteFacultatif = (max: number) => z.string().trim().max(max).nullable();

export const schemaGarant = z.object({
  id: z.uuid(),
  nom: z.string().trim().min(2, 'Nom du garant trop court.').max(100),
  telephone,
  typePiece: z.enum(TYPES_PIECES).nullable(),
  numeroPiece: texteFacultatif(40),
  adresse: texteFacultatif(200),
  /** Lien avec le client (parent, employeur…). */
  lien: texteFacultatif(60),
});
export type GarantSaisi = z.infer<typeof schemaGarant>;

export const schemaClient = z
  .object({
    id: z.uuid(),
    nom: z.string().trim().min(2, 'Nom trop court.').max(100, 'Nom trop long.'),
    telephone,
    type: z.enum(['DETAIL', 'GROSSISTE']),
    typePiece: z.enum(TYPES_PIECES).nullable(),
    numeroPiece: texteFacultatif(40),
    adresse: texteFacultatif(200),
    /** Plafond de crédit (nul : pas de vente à crédit), fixé par le propriétaire. */
    plafondCredit: z.number().int('Montant entier attendu.').min(0).nullable(),
    archive: z.boolean(),
    /** Garant facultatif (un seul par client) ; nul : aucun. */
    garant: schemaGarant.nullable(),
  })
  .refine((c) => !c.numeroPiece || c.typePiece, {
    path: ['typePiece'],
    message: 'Précisez le type de la pièce d’identité.',
  });
export type ClientSaisi = z.infer<typeof schemaClient>;

export const schemaFournisseur = z.object({
  id: z.uuid(),
  nom: z.string().trim().min(2, 'Nom trop court.').max(100),
  telephone: telephone.nullable(),
  adresse: texteFacultatif(200),
  note: texteFacultatif(500),
  archive: z.boolean(),
});
export type FournisseurSaisi = z.infer<typeof schemaFournisseur>;

/**
 * Tout le personnel enregistre des clients (souvent au moment d'une vente), mais :
 * - seul le propriétaire fixe ou change le plafond de crédit ;
 * - seuls le propriétaire et les gérants classent un client « grossiste » (prix de gros).
 * Renvoie le motif du refus, ou null.
 */
export function erreurDroitsClient(
  role: Role,
  avant: { plafondCredit: number | null; type: 'DETAIL' | 'GROSSISTE' } | null,
  apres: { plafondCredit: number | null; type: 'DETAIL' | 'GROSSISTE' },
): string | null {
  const plafondAvant = avant?.plafondCredit ?? null;
  if (apres.plafondCredit !== plafondAvant && role !== 'PROPRIETAIRE') {
    return 'Seul le propriétaire fixe le plafond de crédit.';
  }
  const typeAvant = avant?.type ?? 'DETAIL';
  if (apres.type !== typeAvant && role === 'VENDEUR') {
    return 'Seuls le propriétaire et les gérants classent un client grossiste.';
  }
  return null;
}

/** Texte de recherche d'un client : nom sans accents et chiffres du téléphone. */
export function texteRechercheClient(client: { nom: string; telephone: string }): string {
  const nom = client.nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${nom} ${client.telephone.replace(/\D/g, '')}`;
}
