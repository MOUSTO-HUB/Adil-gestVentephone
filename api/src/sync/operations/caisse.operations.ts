import type { Changement } from '@gestvente/commun';
import {
  changementCaisse,
  cloturerCaisse,
  enregistrerDepense,
  ouvrirCaisse,
  validerCaisse,
} from '../../caisse/caisse.ecritures.js';
import { Role } from '../../generated/prisma/enums.js';
import type { Tx } from '../journal.service.js';
import { versDepense } from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

const TOUS = [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR];

/** État du serveur pour une caisse (ou son effacement sur l'appareil). */
async function etatCaisse(tx: Tx, caisseId: string): Promise<Changement[]> {
  const existe = await tx.caisse.findUnique({ where: { id: caisseId } });
  if (!existe) return [{ seq: 0, entite: 'caisse', id: caisseId, donnees: null }];
  const { entite, id, donnees } = await changementCaisse(tx, caisseId);
  return [{ seq: 0, entite, id, donnees } as Changement];
}

export const caisseOuvrir: Gestionnaire<'CAISSE_OUVRIR'> = {
  type: 'CAISSE_OUVRIR',
  roles: TOUS,
  appliquer: (ctx, contenu) => ouvrirCaisse(ctx, contenu),
  corrections: (tx, _operation, contenu) => etatCaisse(tx, contenu.id),
};

export const caisseCloturer: Gestionnaire<'CAISSE_CLOTURER'> = {
  type: 'CAISSE_CLOTURER',
  roles: TOUS,
  appliquer: (ctx, contenu) => cloturerCaisse(ctx, contenu),
  corrections: (tx, _operation, contenu) => etatCaisse(tx, contenu.caisseId),
};

export const caisseValider: Gestionnaire<'CAISSE_VALIDER'> = {
  type: 'CAISSE_VALIDER',
  roles: [Role.PROPRIETAIRE, Role.GERANT],
  appliquer: (ctx, contenu) => validerCaisse(ctx, contenu),
  corrections: (tx, _operation, contenu) => etatCaisse(tx, contenu.caisseId),
};

export const depenseEnregistrer: Gestionnaire<'DEPENSE_ENREGISTRER'> = {
  type: 'DEPENSE_ENREGISTRER',
  roles: TOUS,
  appliquer: (ctx, contenu) => enregistrerDepense(ctx, contenu),
  async corrections(tx, _operation, contenu) {
    const depense = await tx.depense.findUnique({ where: { id: contenu.id } });
    return [
      { seq: 0, entite: 'depense', id: contenu.id, donnees: depense && versDepense(depense) },
      ...(contenu.caisseId ? await etatCaisse(tx, contenu.caisseId) : []),
    ];
  },
};
