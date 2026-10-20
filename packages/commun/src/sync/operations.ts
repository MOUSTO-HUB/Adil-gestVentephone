import { z } from 'zod';
import {
  schemaCategorie,
  schemaMarque,
  schemaModele,
  schemaPrixBoutique,
  schemaProduit,
} from '../catalogue.js';
import {
  schemaAchat,
  schemaAnnulationAchat,
  schemaPaiementAchat,
  schemaReception,
  schemaSeuil,
} from '../achats.js';
import { schemaClient, schemaFournisseur } from '../clients.js';
import { schemaInventaire } from '../inventaire.js';
import { schemaAnnulationVente, schemaVente } from '../ventes.js';
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
  /** Création ou modification d'une marque (catalogue commun) ; gérant ou propriétaire. */
  MARQUE_ENREGISTRER: schemaMarque,
  /** Création ou modification d'un modèle de téléphone. */
  MODELE_ENREGISTRER: schemaModele,
  /** Création ou modification d'une catégorie. */
  CATEGORIE_ENREGISTRER: schemaCategorie,
  /** Création ou modification d'un produit, de ses prix communs et de ses compatibilités. */
  PRODUIT_ENREGISTRER: schemaProduit,
  /** Prix propres à la boutique de l'opération (tous nuls : retour aux prix communs). */
  PRIX_BOUTIQUE_ENREGISTRER: schemaPrixBoutique,
  /** Création ou modification d'un client et de son garant (tout le personnel, voir erreurDroitsClient). */
  CLIENT_ENREGISTRER: schemaClient,
  /** Création ou modification d'un fournisseur ; gérant ou propriétaire. */
  FOURNISSEUR_ENREGISTRER: schemaFournisseur,
  /** Bon d'achat (brouillon tant que rien n'est reçu) ; gérant ou propriétaire. */
  ACHAT_ENREGISTRER: schemaAchat,
  /** Réception totale ou partielle : IMEI des téléphones, quantités des accessoires. */
  ACHAT_RECEVOIR: schemaReception,
  /** Paiement au fournisseur sur un bon. */
  ACHAT_PAYER: schemaPaiementAchat,
  /** Annulation d'un bon dont rien n'a été reçu. */
  ACHAT_ANNULER: schemaAnnulationAchat,
  /** Seuil d'alerte de stock d'un produit dans la boutique. */
  STOCK_SEUIL: schemaSeuil,
  /** Inventaire physique validé : le stock est ajusté aux quantités comptées. */
  INVENTAIRE_VALIDER: schemaInventaire,
  /** Vente au comptant (détail ou gros) : tout le personnel. */
  VENTE_ENREGISTRER: schemaVente,
  /** Annulation d'une vente, avec motif : gérant ou propriétaire. */
  VENTE_ANNULER: schemaAnnulationVente,
} as const;

export type TypeOperation = keyof typeof schemasContenus;
export const TYPES_OPERATIONS = Object.keys(schemasContenus) as TypeOperation[];
export type ContenuOperation<T extends TypeOperation> = z.infer<(typeof schemasContenus)[T]>;

export const LIBELLES_OPERATIONS: Record<TypeOperation, string> = {
  STOCK_AJUSTER: 'Ajustement de stock',
  ARTICLE_SORTIR: 'Sortie d’un téléphone',
  MARQUE_ENREGISTRER: 'Marque',
  MODELE_ENREGISTRER: 'Modèle',
  CATEGORIE_ENREGISTRER: 'Catégorie',
  PRODUIT_ENREGISTRER: 'Fiche produit',
  PRIX_BOUTIQUE_ENREGISTRER: 'Prix de la boutique',
  CLIENT_ENREGISTRER: 'Fiche client',
  FOURNISSEUR_ENREGISTRER: 'Fiche fournisseur',
  ACHAT_ENREGISTRER: 'Bon d’achat',
  ACHAT_RECEVOIR: 'Réception d’achat',
  ACHAT_PAYER: 'Paiement fournisseur',
  ACHAT_ANNULER: 'Annulation d’un bon d’achat',
  STOCK_SEUIL: 'Seuil de stock',
  INVENTAIRE_VALIDER: 'Inventaire',
  VENTE_ENREGISTRER: 'Vente',
  VENTE_ANNULER: 'Annulation de vente',
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
