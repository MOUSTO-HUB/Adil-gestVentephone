import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';

/** Utilisateur authentifié, attaché à la requête par JwtAuthGuard (lu en base à chaque requête). */
export interface UtilisateurConnecte {
  id: string;
  role: Role;
  commerceId: string;
  /** Appareil de la session : sa révocation coupe l'accès aussitôt. */
  appareilId: string;
  /** Boutiques auxquelles l'utilisateur est rattaché (le propriétaire les a toutes). */
  boutiqueIds: string[];
}

/** Contenu du jeton d'accès JWT. */
export interface ChargeJeton {
  sub: string;
  commerceId: string;
  appareilId: string;
}

export interface RequeteAuthentifiee extends Request {
  utilisateur?: UtilisateurConnecte;
}
