import { z } from 'zod';
import type { Changement } from './entites.js';

/**
 * Opérations faites sur un appareil (souvent hors ligne), envoyées au serveur.
 * Chaque fonctionnalité ajoute ici ses types et le schéma de leur contenu.
 */
export const schemasContenus = {
  /** Ajustement de la quantité d'un accessoire (inventaire, casse) ; gérant ou propriétaire. */
  STOCK_AJUSTER: z.object({
    produitId: z.uuid(),
    delta: z
      .number()
      .int()
      .refine((d) => d !== 0, 'La variation ne peut pas être nulle.'),
    motif: z.string().trim().min(3).max(200),
  }),
  /** Sortie d'un téléphone du stock (perte, casse, vol) ; gérant ou propriétaire. */
  ARTICLE_SORTIR: z.object({
    articleId: z.uuid(),
    motif: z.string().trim().min(3).max(200),
  }),
} as const;

export type TypeOperation = keyof typeof schemasContenus;
export const TYPES_OPERATIONS = Object.keys(schemasContenus) as TypeOperation[];
export type ContenuOperation<T extends TypeOperation> = z.infer<(typeof schemasContenus)[T]>;

export const LIBELLES_OPERATIONS: Record<TypeOperation, string> = {
  STOCK_AJUSTER: 'Ajustement de stock',
  ARTICLE_SORTIR: 'Sortie d’un téléphone',
};

/** Enveloppe commune à toutes les opérations. */
export const schemaOperation = z.object({
  /** UUID généré sur l'appareil : clé d'idempotence. */
  id: z.uuid(),
  type: z.enum(TYPES_OPERATIONS as [TypeOperation, ...TypeOperation[]]),
  boutiqueId: z.uuid(),
  /** Date de l'opération sur l'appareil (ISO 8601). */
  faiteLe: z.iso.datetime({ offset: true }),
  contenu: z.unknown(),
});
export type Operation = z.infer<typeof schemaOperation>;

export const TAILLE_LOT_MAX = 100;
export const schemaLot = z.object({
  operations: z.array(schemaOperation).min(1).max(TAILLE_LOT_MAX),
});

export type StatutOperation = 'APPLIQUEE' | 'REJETEE' | 'CONFLIT';

export interface ResultatOperation {
  id: string;
  statut: StatutOperation;
  /** Raison d'un rejet ou d'un conflit, à montrer à l'utilisateur. */
  motif?: string;
  /**
   * Rejet ou conflit : état du serveur pour les éléments touchés, que l'appareil
   * remet à la place de sa modification locale.
   */
  corrections?: Changement[];
}

/** Valide le contenu d'une opération ; renvoie un message d'erreur ou null. */
export function erreurContenu(type: TypeOperation, contenu: unknown): string | null {
  const resultat = schemasContenus[type].safeParse(contenu);
  if (resultat.success) return null;
  return resultat.error.issues.map((i) => i.message).join(' ');
}
