import type { Changement } from '@gestvente/commun';
import { encaisserTranche } from '../../credits/credit.ecritures.js';
import { Role } from '../../generated/prisma/enums.js';
import type { Tx } from '../journal.service.js';
import { versCredit, versEcheance, versEncaissement } from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

/** État du serveur pour un crédit (ou son effacement sur l'appareil) et ses tranches. */
export async function etatCredit(
  tx: Tx,
  credit: { id: string; echeanceIds?: string[] },
): Promise<Changement[]> {
  const serveur = await tx.credit.findUnique({
    where: { id: credit.id },
    include: { echeances: true, vente: { select: { numero: true } } },
  });
  const tranches = serveur?.echeances ?? [];
  const absentes = (credit.echeanceIds ?? []).filter((id) => !tranches.some((e) => e.id === id));
  return [
    { seq: 0, entite: 'credit', id: credit.id, donnees: serveur && versCredit(serveur) },
    ...tranches.map((e) => ({
      seq: 0,
      entite: 'echeance' as const,
      id: e.id,
      donnees: versEcheance(e),
    })),
    ...absentes.map((id) => ({ seq: 0, entite: 'echeance' as const, id, donnees: null })),
  ];
}

/** Tout le personnel encaisse les tranches (même hors ligne). */
export const creditEncaisser: Gestionnaire<'CREDIT_ENCAISSER'> = {
  type: 'CREDIT_ENCAISSER',
  roles: [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR],
  appliquer: (ctx, contenu) => encaisserTranche(ctx, contenu),
  async corrections(tx, _operation, contenu) {
    const encaissement = await tx.encaissement.findUnique({ where: { id: contenu.id } });
    return [
      ...(await etatCredit(tx, { id: contenu.creditId })),
      {
        seq: 0,
        entite: 'encaissement',
        id: contenu.id,
        donnees: encaissement && versEncaissement(encaissement),
      },
    ];
  },
};
