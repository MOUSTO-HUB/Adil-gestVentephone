import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service.js';
import { peutAccederBoutique } from '../acces.regles.js';
import type { RequeteAuthentifiee } from '../auth.types.js';
import { CLE_PARAM_BOUTIQUE } from '../decorateurs.js';

/**
 * À poser avec @UseGuards(BoutiqueGuard) sur toute route qui prend un identifiant
 * de boutique : refuse une boutique d'un autre commerce (404) ou à laquelle
 * l'employé n'est pas rattaché (403).
 */
@Injectable()
export class BoutiqueGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const nom =
      this.reflector.getAllAndOverride<string>(CLE_PARAM_BOUTIQUE, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? 'boutiqueId';
    const requete = ctx.switchToHttp().getRequest<RequeteAuthentifiee>();
    const valeur: unknown =
      requete.params?.[nom] ??
      (requete.query as Record<string, unknown> | undefined)?.[nom] ??
      (requete.body as Record<string, unknown> | undefined)?.[nom];
    if (typeof valeur !== 'string' || !valeur) {
      throw new BadRequestException(`Paramètre ${nom} manquant.`);
    }

    const utilisateur = requete.utilisateur;
    const boutique = await this.prisma.boutique.findUnique({
      where: { id: valeur },
      select: { id: true, commerceId: true, verrouillee: true, supprimeeLe: true },
    });
    if (!utilisateur || !boutique || boutique.commerceId !== utilisateur.commerceId) {
      throw new NotFoundException('Boutique introuvable.');
    }
    if (boutique.verrouillee || boutique.supprimeeLe) {
      throw new ForbiddenException('Boutique verrouillée par la plateforme.');
    }
    if (!peutAccederBoutique(utilisateur, boutique)) {
      throw new ForbiddenException("Vous n'êtes pas rattaché à cette boutique.");
    }
    return true;
  }
}
