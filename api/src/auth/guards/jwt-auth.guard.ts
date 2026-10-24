import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BOUTIQUE_OUVERTE, refusCommerce } from '../acces.regles.js';
import type { ChargeJeton, RequeteAuthentifiee } from '../auth.types.js';
import { CLE_PUBLIC } from '../decorateurs.js';

/**
 * Garde global : exige un jeton d'accès valide, sauf sur les routes @Public().
 * L'appareil et le compte sont relus en base à chaque requête : une déconnexion
 * à distance, un compte désactivé ou un changement de rôle s'appliquent aussitôt.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const estPublic = this.reflector.getAllAndOverride<boolean>(CLE_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (estPublic) return true;

    const requete = ctx.switchToHttp().getRequest<RequeteAuthentifiee>();
    const [type, jeton] = requete.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !jeton) {
      throw new UnauthorizedException("Jeton d'accès manquant.");
    }

    let charge: ChargeJeton;
    try {
      charge = await this.jwt.verifyAsync<ChargeJeton>(jeton);
    } catch {
      throw new UnauthorizedException("Jeton d'accès invalide ou expiré.");
    }
    // Les autres jetons signés (concepteur, autorisations du gérant) n'ouvrent pas de session.
    if (!charge.appareilId || (charge as { type?: string }).type) {
      throw new UnauthorizedException("Jeton d'accès invalide ou expiré.");
    }

    const appareil = await this.prisma.appareil.findUnique({
      where: { id: charge.appareilId },
      select: {
        revoqueLe: true,
        utilisateur: {
          select: {
            id: true,
            commerceId: true,
            role: true,
            actif: true,
            commerce: { select: { statut: true, motifStatut: true, abonnementJusquAu: true } },
            boutiques: {
              where: { boutique: BOUTIQUE_OUVERTE },
              select: { boutiqueId: true },
            },
          },
        },
      },
    });
    const utilisateur = appareil?.utilisateur;
    if (!appareil || appareil.revoqueLe || !utilisateur?.actif || utilisateur.id !== charge.sub) {
      throw new UnauthorizedException('Session fermée. Reconnectez-vous.');
    }

    // Commerce suspendu ou retiré par le concepteur : plus aucune requête.
    const refus = refusCommerce(utilisateur.commerce);
    if (refus) throw new ForbiddenException(refus);

    // Le propriétaire a accès à toutes les boutiques ouvertes de son commerce.
    const boutiqueIds =
      utilisateur.role === Role.PROPRIETAIRE
        ? (
            await this.prisma.boutique.findMany({
              where: { commerceId: utilisateur.commerceId, ...BOUTIQUE_OUVERTE },
              select: { id: true },
            })
          ).map((b) => b.id)
        : utilisateur.boutiques.map((b) => b.boutiqueId);

    requete.utilisateur = {
      id: utilisateur.id,
      role: utilisateur.role,
      commerceId: utilisateur.commerceId,
      appareilId: charge.appareilId,
      boutiqueIds,
    };
    return true;
  }
}
