import { Injectable } from '@nestjs/common';
import type { DonneesEntites, EntiteSync } from '@gestvente/commun';
import type { Prisma } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

export interface NouveauChangement<E extends EntiteSync = EntiteSync> {
  entite: E;
  id: string;
  /** Nul : visible de toutes les boutiques (catalogue). */
  boutiqueId: string | null;
  /** Nul : suppression. */
  donnees: DonneesEntites[E] | null;
}

/**
 * Journal des changements que les appareils récupèrent. Toute modification d'une
 * donnée synchronisée l'y inscrit, dans la même transaction.
 */
@Injectable()
export class JournalService {
  /**
   * Verrou du commerce jusqu'à la fin de la transaction : les opérations d'un
   * commerce s'appliquent une à une (pas de double vente d'un IMEI) et les
   * numéros du journal sont validés dans l'ordre.
   */
  async verrouiller(tx: Tx, commerceId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 AS verrou FROM pg_advisory_xact_lock(hashtext(${commerceId}))`;
  }

  async ecrire(tx: Tx, commerceId: string, changements: NouveauChangement[]): Promise<void> {
    if (changements.length === 0) return;
    await this.verrouiller(tx, commerceId);
    await tx.changement.createMany({
      data: changements.map((c) => ({
        commerceId,
        boutiqueId: c.boutiqueId,
        entite: c.entite,
        entiteId: c.id,
        donnees: (c.donnees ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  }
}
