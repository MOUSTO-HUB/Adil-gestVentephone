import { z } from 'zod';

/** Règles du catalogue, partagées par l'API (opérations, import Excel) et l'application (formulaires). */

const montant = z.number().int('Montant entier attendu.').min(0, 'Montant négatif.');

export const GARANTIE_MOIS_MAX = 60;

export const schemaProduit = z
  .object({
    id: z.uuid(),
    type: z.enum(['TELEPHONE', 'ACCESSOIRE']),
    categorieId: z.uuid(),
    marqueId: z.uuid().nullable(),
    /** Modèle de téléphone (variantes de téléphone uniquement). */
    modeleId: z.uuid().nullable(),
    nom: z.string().trim().min(2, 'Nom trop court.').max(120, 'Nom trop long.'),
    capacite: z.string().trim().max(30).nullable(),
    couleur: z.string().trim().max(30).nullable(),
    etat: z.enum(['NEUF', 'OCCASION']),
    codeBarres: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z-]{4,32}$/, 'Code-barres : 4 à 32 chiffres ou lettres.')
      .nullable(),
    garantieMois: z.number().int().min(0).max(GARANTIE_MOIS_MAX),
    prixAchat: montant,
    prixDetail: montant,
    prixGros: montant,
    /** Quantité à partir de laquelle le prix de gros s'applique (nul : jamais automatiquement). */
    seuilGros: z.number().int().min(2, 'Seuil de gros : au moins 2.').nullable(),
    archive: z.boolean(),
    /** Modèles de téléphone compatibles (accessoires uniquement). */
    compatibles: z.array(z.uuid()).max(200),
  })
  .superRefine((p, ctx) => {
    if (p.prixGros > p.prixDetail) {
      ctx.addIssue({
        code: 'custom',
        path: ['prixGros'],
        message: 'Le prix de gros ne peut pas dépasser le prix de détail.',
      });
    }
    if (p.type === 'ACCESSOIRE' && p.modeleId) {
      ctx.addIssue({
        code: 'custom',
        path: ['modeleId'],
        message: 'Un accessoire n’a pas de modèle : indiquez plutôt les modèles compatibles.',
      });
    }
    if (p.type === 'TELEPHONE' && p.compatibles.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['compatibles'],
        message: 'Seuls les accessoires ont des modèles compatibles.',
      });
    }
  });
export type ProduitSaisi = z.infer<typeof schemaProduit>;

export const schemaMarque = z.object({
  id: z.uuid(),
  nom: z.string().trim().min(1, 'Nom de marque obligatoire.').max(60),
});

export const schemaModele = z.object({
  id: z.uuid(),
  marqueId: z.uuid(),
  nom: z.string().trim().min(1, 'Nom de modèle obligatoire.').max(60),
});

export const schemaCategorie = z.object({
  id: z.uuid(),
  nom: z.string().trim().min(1, 'Nom de catégorie obligatoire.').max(60),
  type: z.enum(['TELEPHONE', 'ACCESSOIRE']),
});

/** Prix propres à une boutique ; nul : le prix commun s'applique. */
export const schemaPrixBoutique = z
  .object({
    produitId: z.uuid(),
    prixAchat: montant.nullable(),
    prixDetail: montant.nullable(),
    prixGros: montant.nullable(),
  })
  .refine((p) => p.prixGros === null || p.prixDetail === null || p.prixGros <= p.prixDetail, {
    path: ['prixGros'],
    message: 'Le prix de gros ne peut pas dépasser le prix de détail.',
  });

/**
 * Identifiant local d'un prix de boutique créé hors ligne, avant que le serveur ne
 * donne le sien (le serveur l'utilise pour faire effacer la ligne en cas de refus).
 */
export const idPrixBoutiqueProvisoire = (produitId: string, boutiqueId: string) =>
  `provisoire:${produitId}:${boutiqueId}`;

/** Nom proposé pour une variante : « Samsung Galaxy A15 128 Go Noir ». */
export function nomPropose(parties: {
  marque?: string | null;
  modele?: string | null;
  capacite?: string | null;
  couleur?: string | null;
}): string {
  return [parties.marque, parties.modele, parties.capacite, parties.couleur]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');
}

/** Prix appliqués dans une boutique : ceux de la boutique, sinon les prix communs. */
export function prixApplicables<
  P extends { prixAchat: number | null; prixDetail: number; prixGros: number },
>(
  produit: P,
  boutique: { prixAchat: number | null; prixDetail: number | null; prixGros: number | null } | null,
): { prixAchat: number | null; prixDetail: number; prixGros: number } {
  return {
    prixAchat: boutique?.prixAchat ?? produit.prixAchat,
    prixDetail: boutique?.prixDetail ?? produit.prixDetail,
    prixGros: boutique?.prixGros ?? produit.prixGros,
  };
}

/** Texte de recherche : minuscules, sans accents ni ponctuation, espaces simples. */
export function normaliserRecherche(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mots d'une recherche (« galaxy a15 noir » trouve « Samsung Galaxy A15 128 Go Noir »). */
export function motsRecherche(terme: string): string[] {
  return normaliserRecherche(terme).split(' ').filter(Boolean).slice(0, 6);
}

/** Texte indexé d'un produit pour la recherche locale. */
export function texteRecherche(produit: {
  nom: string;
  capacite?: string | null;
  couleur?: string | null;
  codeBarres?: string | null;
}): string {
  return normaliserRecherche(
    [produit.nom, produit.capacite, produit.couleur, produit.codeBarres].filter(Boolean).join(' '),
  );
}
