import { z } from 'zod';

/**
 * Transferts de stock entre boutiques : demande de la boutique qui reçoit (ou envoi
 * direct du propriétaire), envoi par scan (téléphones EN_TRANSFERT, retirés du stock
 * de départ), réception par scan à l'arrivée : le stock d'arrivée n'augmente qu'à la
 * confirmation, les écarts sont signalés.
 */

export const STATUTS_TRANSFERT = ['DEMANDE', 'ENVOYE', 'RECU', 'ANNULE'] as const;
export type StatutTransfert = (typeof STATUTS_TRANSFERT)[number];

export const LIBELLES_STATUTS_TRANSFERT: Record<StatutTransfert, string> = {
  DEMANDE: 'Demandé',
  ENVOYE: 'En route',
  RECU: 'Reçu',
  ANNULE: 'Annulé',
};

const ligneDemandee = z.object({
  id: z.uuid(),
  produitId: z.uuid(),
  quantite: z.number().int().min(1).max(10_000),
});

/** Demande de la boutique qui reçoit (boutique de l'opération). */
export const schemaDemandeTransfert = z.object({
  id: z.uuid(),
  numero: z.string().trim().min(3).max(40),
  boutiqueDepartId: z.uuid(),
  lignes: z.array(ligneDemandee).min(1, 'Ajoutez au moins un produit.').max(500),
  note: z.string().trim().max(300).nullable(),
});

/**
 * Envoi par la boutique de départ (boutique de l'opération) : prépare une demande
 * (mêmes identifiants) ou crée un envoi direct. Un téléphone = une ligne, avec son article.
 */
export const schemaEnvoiTransfert = z.object({
  id: z.uuid(),
  numero: z.string().trim().min(3).max(40),
  boutiqueArriveeId: z.uuid(),
  lignes: z
    .array(
      z.object({
        id: z.uuid(),
        produitId: z.uuid(),
        articleId: z.uuid().nullable(),
        quantite: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1, 'Rien à envoyer.')
    .max(500)
    .refine((l) => l.every((x) => x.articleId === null || x.quantite === 1), {
      message: 'Un téléphone s’envoie à l’unité.',
    })
    .refine(
      (l) => {
        const articles = l.flatMap((x) => (x.articleId ? [x.articleId] : []));
        return new Set(articles).size === articles.length;
      },
      { message: 'Un même téléphone ne s’envoie qu’une fois.' },
    ),
  note: z.string().trim().max(300).nullable(),
});

/** Réception par la boutique d'arrivée : quantités comptées, téléphones scannés. */
export const schemaReceptionTransfert = z.object({
  transfertId: z.uuid(),
  recuLe: z.iso.datetime({ offset: true }),
  /** Accessoires : quantité comptée par ligne. */
  quantites: z.array(z.object({ ligneId: z.uuid(), quantite: z.number().int().min(0) })).max(500),
  /** Téléphones scannés à l'arrivée. */
  articlesRecus: z.array(z.uuid()).max(500),
  note: z.string().trim().max(300).nullable(),
});

export const schemaAnnulationTransfert = z.object({
  transfertId: z.uuid(),
  motif: z.string().trim().min(3, 'Motif obligatoire.').max(200),
});

export type EnvoiTransfert = z.infer<typeof schemaEnvoiTransfert>;
export type ReceptionTransfert = z.infer<typeof schemaReceptionTransfert>;

export interface LigneEnvoyee {
  id: string;
  produitId: string;
  articleId: string | null;
  quantite: number;
}

/**
 * Quantité reçue par ligne (téléphone : 1 s'il a été scanné, sinon 0 ; accessoire :
 * quantité comptée, au plus la quantité envoyée) et écarts à signaler.
 */
export function bilanReception(
  lignes: LigneEnvoyee[],
  recus: Pick<ReceptionTransfert, 'quantites' | 'articlesRecus'>,
): {
  recues: { ligneId: string; quantite: number }[];
  ecarts: { ligneId: string; envoye: number; recu: number }[];
  /** Téléphones scannés qui ne font pas partie du transfert. */
  inattendus: string[];
} {
  const scannes = new Set(recus.articlesRecus);
  const recues = lignes.map((l) => {
    const quantite = l.articleId
      ? scannes.has(l.articleId)
        ? 1
        : 0
      : Math.min(l.quantite, recus.quantites.find((q) => q.ligneId === l.id)?.quantite ?? 0);
    return { ligneId: l.id, quantite };
  });
  const attendus = new Set(lignes.flatMap((l) => (l.articleId ? [l.articleId] : [])));
  return {
    recues,
    ecarts: lignes.flatMap((l, i) =>
      recues[i].quantite < l.quantite
        ? [{ ligneId: l.id, envoye: l.quantite, recu: recues[i].quantite }]
        : [],
    ),
    inattendus: recus.articlesRecus.filter((a) => !attendus.has(a)),
  };
}

/** Le départ et l'arrivée diffèrent ; l'arrivée est une boutique du commerce. */
export function erreurBoutiquesTransfert(departId: string, arriveeId: string): string | null {
  return departId === arriveeId ? 'Choisissez une autre boutique que celle de départ.' : null;
}
