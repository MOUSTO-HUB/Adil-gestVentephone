import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../generated/prisma/enums.js';
import type { RequeteAuthentifiee } from '../auth.types.js';
import { CLE_ROLES } from '../decorateurs.js';

/** Garde global : applique @Roles(...). Sans @Roles, tout utilisateur connecté passe. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(CLE_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;
    const { utilisateur } = ctx.switchToHttp().getRequest<RequeteAuthentifiee>();
    if (!utilisateur || !roles.includes(utilisateur.role)) {
      throw new ForbiddenException("Votre rôle ne permet pas d'accéder à cette ressource.");
    }
    return true;
  }
}
