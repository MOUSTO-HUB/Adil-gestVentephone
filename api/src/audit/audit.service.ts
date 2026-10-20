import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ipRequete } from '../securite/contexte-requete.js';

/** Actions inscrites au journal d'audit (opérations sensibles). */
export const ACTIONS_AUDIT = {
  CONNEXION: 'CONNEXION',
  CONNEXION_ECHEC: 'CONNEXION_ECHEC',
  DECONNEXION: 'DECONNEXION',
  DECONNEXION_A_DISTANCE: 'DECONNEXION_A_DISTANCE',
  JETON_REUTILISE: 'JETON_REUTILISE',
  PIN_DEFINI: 'PIN_DEFINI',
  AJUSTEMENT_STOCK: 'AJUSTEMENT_STOCK',
  SORTIE_ARTICLE: 'SORTIE_ARTICLE',
  CONFLIT_TRAITE: 'CONFLIT_TRAITE',
  PRODUIT_CREE: 'PRODUIT_CREE',
  PRIX_MODIFIE: 'PRIX_MODIFIE',
  PRODUIT_ARCHIVE: 'PRODUIT_ARCHIVE',
  PRODUIT_RESTAURE: 'PRODUIT_RESTAURE',
  PHOTO_MODIFIEE: 'PHOTO_MODIFIEE',
  IMPORT_CATALOGUE: 'IMPORT_CATALOGUE',
  PLAFOND_CREDIT_MODIFIE: 'PLAFOND_CREDIT_MODIFIE',
  PIECE_IDENTITE_MODIFIEE: 'PIECE_IDENTITE_MODIFIEE',
  PIECE_IDENTITE_CONSULTEE: 'PIECE_IDENTITE_CONSULTEE',
  RECEPTION_ACHAT: 'RECEPTION_ACHAT',
  PAIEMENT_FOURNISSEUR: 'PAIEMENT_FOURNISSEUR',
  ANNULATION_ACHAT: 'ANNULATION_ACHAT',
  INVENTAIRE_VALIDE: 'INVENTAIRE_VALIDE',
  REMISE_AUTORISEE: 'REMISE_AUTORISEE',
  REMISE_ACCORDEE: 'REMISE_ACCORDEE',
  ECART_PRIX: 'ECART_PRIX',
  VENTE_ANNULEE: 'VENTE_ANNULEE',
  RETOUR_AUTORISE: 'RETOUR_AUTORISE',
  RETOUR_ENREGISTRE: 'RETOUR_ENREGISTRE',
  CAISSE_OUVERTE: 'CAISSE_OUVERTE',
  CAISSE_CLOTUREE: 'CAISSE_CLOTUREE',
  CAISSE_VALIDEE: 'CAISSE_VALIDEE',
  DEPENSE_ENREGISTREE: 'DEPENSE_ENREGISTREE',
  JUSTIFICATIF_MODIFIE: 'JUSTIFICATIF_MODIFIE',
} as const;
export type ActionAudit = (typeof ACTIONS_AUDIT)[keyof typeof ACTIONS_AUDIT];

export interface EntreeAudit {
  commerceId: string;
  action: ActionAudit;
  utilisateurId?: string;
  appareilId?: string;
  boutiqueId?: string;
  entite?: string;
  entiteId?: string;
  details?: Prisma.InputJsonValue;
}

/** Journal des opérations sensibles ; l'IP de la requête est ajoutée automatiquement. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** `tx` : inscrit l'entrée dans la transaction en cours (annulée avec elle). */
  async journaliser(entree: EntreeAudit, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).journalAudit.create({ data: { ...entree, ip: ipRequete() } });
  }
}
