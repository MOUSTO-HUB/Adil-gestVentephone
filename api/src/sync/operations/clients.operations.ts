import type { Changement } from '@gestvente/commun';
import {
  detteFournisseur,
  enregistrerClient,
  enregistrerFournisseur,
} from '../../clients/clients.ecritures.js';
import { Role } from '../../generated/prisma/enums.js';
import { versClient, versFournisseur, versGarant } from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

/** Tout le personnel enregistre des clients (droits fins : erreurDroitsClient). */
export const clientEnregistrer: Gestionnaire<'CLIENT_ENREGISTRER'> = {
  type: 'CLIENT_ENREGISTRER',
  roles: [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR],
  appliquer: (ctx, contenu) => enregistrerClient(ctx, contenu),
  async corrections(tx, _op, contenu) {
    const client = await tx.client.findUnique({ where: { id: contenu.id } });
    const garants = client ? await tx.garant.findMany({ where: { clientId: client.id } }) : [];
    const corrections: Changement[] = [
      { seq: 0, entite: 'client', id: contenu.id, donnees: client && versClient(client) },
      ...garants.map((g) => ({
        seq: 0,
        entite: 'garant' as const,
        id: g.id,
        donnees: versGarant(g),
      })),
    ];
    // Garant ajouté sur l'appareil mais refusé : l'appareil l'efface.
    if (contenu.garant && !garants.some((g) => g.id === contenu.garant?.id)) {
      corrections.push({ seq: 0, entite: 'garant', id: contenu.garant.id, donnees: null });
    }
    return corrections;
  },
};

export const fournisseurEnregistrer: Gestionnaire<'FOURNISSEUR_ENREGISTRER'> = {
  type: 'FOURNISSEUR_ENREGISTRER',
  roles: [Role.PROPRIETAIRE, Role.GERANT],
  appliquer: (ctx, contenu) => enregistrerFournisseur(ctx, contenu),
  async corrections(tx, _op, contenu) {
    const f = await tx.fournisseur.findUnique({ where: { id: contenu.id } });
    return [
      {
        seq: 0,
        entite: 'fournisseur',
        id: contenu.id,
        donnees: f && versFournisseur(f, await detteFournisseur(tx, f.id)),
      },
    ];
  },
};
