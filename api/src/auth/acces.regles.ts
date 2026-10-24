import { etatAbonnement, messageAbonnementExpire } from '@gestvente/commun';
import { Role } from '../generated/prisma/enums.js';

export interface Acteur {
  id: string;
  role: Role;
  commerceId: string;
  boutiqueIds: string[];
}

/** Un employé n'accède qu'aux boutiques de son rattachement ; le propriétaire à toutes celles de son commerce. */
/** Une boutique verrouillée ou retirée par le concepteur ne reçoit plus d'opérations. */
export const BOUTIQUE_OUVERTE = { verrouillee: false, supprimeeLe: null } as const;

/**
 * Message d'un commerce suspendu, retiré de la plateforme ou dont l'abonnement a expiré
 * (échéance + délai de grâce) ; null : accès ouvert. Les données ne sont jamais touchées.
 */
export function refusCommerce(
  commerce: {
    statut: 'ACTIF' | 'SUSPENDU' | 'SUPPRIME';
    motifStatut: string | null;
    abonnementJusquAu: Date | null;
  },
  maintenant = new Date(),
): string | null {
  if (commerce.statut === 'ACTIF') {
    const { etat } = etatAbonnement(commerce.abonnementJusquAu, null, maintenant);
    return etat === 'EXPIRE' && commerce.abonnementJusquAu
      ? messageAbonnementExpire(commerce.abonnementJusquAu)
      : null;
  }
  const motif = commerce.motifStatut ? ` (${commerce.motifStatut})` : '';
  return commerce.statut === 'SUSPENDU'
    ? `L'accès de votre commerce est suspendu${motif}. Contactez GestVente pour le rétablir.`
    : `Ce commerce n'est plus sur la plateforme${motif}.`;
}

export function peutAccederBoutique(
  utilisateur: Acteur,
  boutique: { id: string; commerceId: string },
): boolean {
  if (boutique.commerceId !== utilisateur.commerceId) return false;
  return utilisateur.role === Role.PROPRIETAIRE || utilisateur.boutiqueIds.includes(boutique.id);
}

/**
 * Qui peut voir et couper les sessions (appareils) de qui :
 * - chacun les siennes ;
 * - le propriétaire celles de tous ses employés ;
 * - un gérant celles des vendeurs d'une de ses boutiques (jamais celles du propriétaire ni d'un autre gérant).
 */
export function peutGererSessionsDe(acteur: Acteur, cible: Acteur): boolean {
  if (acteur.commerceId !== cible.commerceId) return false;
  if (acteur.id === cible.id) return true;
  if (acteur.role === Role.PROPRIETAIRE) return true;
  if (acteur.role === Role.GERANT && cible.role === Role.VENDEUR) {
    return cible.boutiqueIds.some((id) => acteur.boutiqueIds.includes(id));
  }
  return false;
}
