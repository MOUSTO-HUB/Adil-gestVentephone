import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/** Jeton du concepteur : distinct de ceux des commerçants (type « concepteur », sans appareil). */
export interface ChargeConcepteur {
  type: 'concepteur';
  sub: string;
}

export interface ConcepteurConnecte {
  id: string;
  nom: string;
}

interface RequeteConcepteur extends Request {
  concepteur?: ConcepteurConnecte;
}

/**
 * Garde des routes /plateforme (déclarées @Public() pour le garde des commerçants) :
 * jeton de concepteur valide et compte actif, relu à chaque requête.
 */
@Injectable()
export class ConcepteurGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requete = ctx.switchToHttp().getRequest<RequeteConcepteur>();
    const [type, jeton] = requete.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !jeton)
      throw new UnauthorizedException('Connexion du concepteur requise.');
    let charge: ChargeConcepteur;
    try {
      charge = await this.jwt.verifyAsync<ChargeConcepteur>(jeton);
    } catch {
      throw new UnauthorizedException('Session du concepteur expirée. Reconnectez-vous.');
    }
    if (charge.type !== 'concepteur')
      throw new UnauthorizedException('Connexion du concepteur requise.');
    const concepteur = await this.prisma.concepteur.findUnique({ where: { id: charge.sub } });
    if (!concepteur?.actif) throw new UnauthorizedException('Compte de concepteur désactivé.');
    requete.concepteur = { id: concepteur.id, nom: concepteur.nom };
    return true;
  }
}

export const ConcepteurCourant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ConcepteurConnecte =>
    ctx.switchToHttp().getRequest<RequeteConcepteur>().concepteur!,
);
