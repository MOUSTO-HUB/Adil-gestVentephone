import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LIMITES, LimiteurService } from './limiteur.service.js';

/** Adresses locales (développement, tests, supervision du serveur) : non limitées. */
const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Débit maximal par adresse IP, avant toute autre vérification : requêtes de l'API,
 * et plus strictement le lien public des factures (codes à deviner). Derrière Caddy,
 * l'IP est celle du client (X-Forwarded-For d'un relais privé seulement).
 */
@Injectable()
export class DebitGuard implements CanActivate {
  constructor(private readonly limiteur: LimiteurService) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const requete = contexte.switchToHttp().getRequest<Request>();
    const ip = requete.ip ?? '';
    if (!ip || LOCALES.has(ip)) return true;
    const limite = requete.path.startsWith('/api/f/')
      ? LIMITES.facturePublique
      : LIMITES.requetesIp;
    await this.limiteur.verifier(limite, ip);
    return true;
  }
}
