export const ROLES = ['PROPRIETAIRE', 'GERANT', 'VENDEUR'] as const;
export type Role = (typeof ROLES)[number];

export const LIBELLES_ROLES: Record<Role, string> = {
  PROPRIETAIRE: 'Propriétaire',
  GERANT: 'Gérant',
  VENDEUR: 'Vendeur',
};

/** Le propriétaire et les gérants gèrent les appareils et sessions des employés. */
export function peutGererSessions(role: Role): boolean {
  return role === 'PROPRIETAIRE' || role === 'GERANT';
}
