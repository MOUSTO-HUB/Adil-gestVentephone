import type {
  Changement,
  ContenuOperation,
  Controle,
  Operation,
  TypeOperation,
} from '@gestvente/commun';
import type { AuditService } from '../../audit/audit.service.js';
import type { AutorisationRemiseService } from '../../ventes/autorisation-remise.service.js';
import type { UtilisateurConnecte } from '../../auth/auth.types.js';
import type { Role } from '../../generated/prisma/enums.js';
import type { JournalService, Tx } from '../journal.service.js';

export interface ContexteOperation {
  tx: Tx;
  utilisateur: UtilisateurConnecte;
  operation: Operation;
  journal: JournalService;
  audit: AuditService;
  autorisations: AutorisationRemiseService;
}

/**
 * Applique un type d'opération reçu d'un appareil. Le gestionnaire contrôle
 * d'abord (rejet ou conflit : rien n'est écrit), puis modifie la base et
 * inscrit les changements au journal.
 */
export interface Gestionnaire<T extends TypeOperation> {
  type: T;
  /** Rôles autorisés à faire ce type d'opération. */
  roles: Role[];
  appliquer(ctx: ContexteOperation, contenu: ContenuOperation<T>): Promise<Controle>;
  /** État actuel du serveur pour les éléments touchés (corrections après rejet ou conflit). */
  corrections(tx: Tx, operation: Operation, contenu: ContenuOperation<T>): Promise<Changement[]>;
}
