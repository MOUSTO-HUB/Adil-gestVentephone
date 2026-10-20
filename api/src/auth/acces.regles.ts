import { Role } from '../generated/prisma/enums.js';

export interface Acteur {
  id: string;
  role: Role;
  commerceId: string;
  boutiqueIds: string[];
}

/** Un employé n'accède qu'aux boutiques de son rattachement ; le propriétaire à toutes celles de son commerce. */
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
