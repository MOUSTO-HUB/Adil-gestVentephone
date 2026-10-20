import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/enums.js';
import type { RequeteAuthentifiee, UtilisateurConnecte } from './auth.types.js';

export const CLE_PUBLIC = 'public';
export const CLE_ROLES = 'roles';
export const CLE_PARAM_BOUTIQUE = 'param-boutique';

/** Rend une route accessible sans jeton (toutes les autres routes l'exigent). */
export const Public = () => SetMetadata(CLE_PUBLIC, true);

/** Restreint une route (ou un contrôleur) aux rôles indiqués. */
export const Roles = (...roles: Role[]) => SetMetadata(CLE_ROLES, roles);

/**
 * Nom du paramètre qui porte l'identifiant de boutique vérifié par BoutiqueGuard
 * (cherché dans le chemin, puis la requête, puis le corps). Par défaut : boutiqueId.
 */
export const ParamBoutique = (nom: string) => SetMetadata(CLE_PARAM_BOUTIQUE, nom);

/** Injecte l'utilisateur connecté dans un paramètre de méthode de contrôleur. */
export const UtilisateurCourant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UtilisateurConnecte | undefined =>
    ctx.switchToHttp().getRequest<RequeteAuthentifiee>().utilisateur,
);
