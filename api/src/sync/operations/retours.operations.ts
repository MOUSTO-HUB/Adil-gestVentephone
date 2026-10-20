import type { Changement } from '@gestvente/commun';
import { Role } from '../../generated/prisma/enums.js';
import { enregistrerRetour } from '../../retours/retours.ecritures.js';
import { versClient, versLigneRetour, versRetour } from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';
import { etatVente } from './ventes.operations.js';

/**
 * Le vendeur enregistre le retour avec le jeton du gérant (vérifié par le serveur).
 * Après refus : le retour est effacé sur l'appareil ; téléphones, stocks, avoir du
 * client et vente d'échange reprennent l'état du serveur.
 */
export const retourEnregistrer: Gestionnaire<'RETOUR_ENREGISTRER'> = {
  type: 'RETOUR_ENREGISTRER',
  roles: [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR],
  appliquer: (ctx, contenu) => enregistrerRetour(ctx, contenu),
  async corrections(tx, operation, contenu) {
    const retour = await tx.retour.findUnique({
      where: { id: contenu.id },
      include: { lignes: true },
    });
    const lignesVente = await tx.ligneVente.findMany({
      where: { id: { in: contenu.lignes.map((l) => l.ligneVenteId) } },
    });
    const vente = await tx.vente.findUnique({
      where: { id: contenu.venteId },
      include: { client: true },
    });
    const corrections: Changement[] = [
      { seq: 0, entite: 'retour', id: contenu.id, donnees: retour && versRetour(retour) },
      ...contenu.lignes.map((l) => {
        const serveur = retour?.lignes.find((x) => x.id === l.id);
        return {
          seq: 0,
          entite: 'ligneRetour' as const,
          id: l.id,
          donnees: serveur ? versLigneRetour(serveur) : null,
        };
      }),
      ...(await etatVente(tx, operation.boutiqueId, contenu.venteId, lignesVente, [])).filter(
        (c) => c.entite === 'article' || c.entite === 'stock',
      ),
    ];
    if (vente?.client) {
      corrections.push({
        seq: 0,
        entite: 'client',
        id: vente.client.id,
        donnees: versClient(vente.client),
      });
    }
    if (contenu.echange) {
      corrections.push(
        ...(await etatVente(
          tx,
          operation.boutiqueId,
          contenu.echange.id,
          contenu.echange.lignes,
          contenu.echange.paiements.map((p) => p.id),
        )),
      );
      const clientEchange = contenu.echange.clientId
        ? await tx.client.findUnique({ where: { id: contenu.echange.clientId } })
        : null;
      if (clientEchange && clientEchange.id !== vente?.client?.id) {
        corrections.push({
          seq: 0,
          entite: 'client',
          id: clientEchange.id,
          donnees: versClient(clientEchange),
        });
      }
    }
    return corrections;
  },
};
