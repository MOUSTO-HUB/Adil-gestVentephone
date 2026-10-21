import { formaterMontant } from '@gestvente/commun';
import { Role } from '../../generated/prisma/enums.js';
import { lienFacture } from '../../messages/facture-publique.js';
import type { Gestionnaire } from './gestionnaire.js';

/**
 * Facture ou reçu d'une vente envoyé au client par SMS ou WhatsApp. Demandé sur
 * l'appareil (même hors ligne), envoyé par le serveur quand l'opération arrive.
 */
export const messageEnvoyer: Gestionnaire<'MESSAGE_ENVOYER'> = {
  type: 'MESSAGE_ENVOYER',
  roles: [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR],
  async appliquer({ tx, utilisateur, operation, messages }, d) {
    const vente = await tx.vente.findFirst({
      where: {
        id: d.venteId,
        commerceId: utilisateur.commerceId,
        boutiqueId: operation.boutiqueId,
      },
      include: { client: true, boutique: true, commerce: true },
    });
    if (!vente)
      return { ok: false, statut: 'REJETEE', motif: 'Vente introuvable dans cette boutique.' };
    if (vente.statut === 'ANNULEE') {
      return { ok: false, statut: 'REJETEE', motif: 'Vente annulée : rien à envoyer.' };
    }
    const destinataire = d.telephone ?? vente.client?.telephone;
    if (!destinataire) {
      return {
        ok: false,
        statut: 'REJETEE',
        motif: 'Aucun numéro : choisissez le client ou saisissez son numéro.',
      };
    }
    const montant = d.type === 'RECU' ? vente.montantPaye : vente.total;
    await messages.envoyer(tx, {
      commerceId: utilisateur.commerceId,
      boutiqueId: vente.boutiqueId,
      clientId: vente.clientId,
      destinataire,
      type: d.type,
      canal: d.canal,
      variables: {
        client: vente.client?.nom ?? 'cher client',
        montant: formaterMontant(Number(montant), '')
          .replace(/\u202f/g, ' ')
          .trim(),
        monnaie: vente.commerce.monnaie,
        numero: vente.numero,
        boutique: vente.boutique.nom,
        commerce: vente.commerce.nom,
        lien: await lienFacture(tx, vente.id, messages.urlPublique),
      },
      referenceType: 'Vente',
      referenceId: vente.id,
    });
    return { ok: true };
  },
  // Rien n'est écrit sur l'appareil pour un envoi : aucune correction.
  corrections: () => Promise.resolve([]),
};
