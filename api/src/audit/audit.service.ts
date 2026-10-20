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
  PHOTO_MODIFIEE: 'PHOTO_MODIFIEE',
  IMPORT_CATALOGUE: 'IMPORT_CATALOGUE',
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
