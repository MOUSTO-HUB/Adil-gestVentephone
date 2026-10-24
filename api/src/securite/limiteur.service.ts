import { HttpException, HttpStatus, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export interface Limite {
  /** Nom de la limite (ex. connexion-ip). */
  nom: string;
  max: number;
  fenetreS: number;
  message: string;
}

/** Limites contre les essais en force (mot de passe, code PIN). */
export const LIMITES = {
  /** Échecs de connexion depuis une même adresse IP (les connexions réussies ne comptent pas). */
  connexionIp: {
    nom: 'connexion-ip',
    max: 30,
    fenetreS: 15 * 60,
    message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
  },
  connexionIdentifiant: {
    nom: 'connexion-identifiant',
    max: 10,
    fenetreS: 15 * 60,
    message: 'Trop de tentatives pour ce compte. Réessayez dans 15 minutes.',
  },
  /** Toutes les requêtes d'une adresse IP (une boutique entière derrière une même box). */
  requetesIp: {
    nom: 'requetes-ip',
    max: 600,
    fenetreS: 60,
    message: 'Trop de requêtes depuis cette connexion. Réessayez dans une minute.',
  },
  /** Lien public des factures : codes aléatoires à ne pas laisser deviner. */
  facturePublique: {
    nom: 'facture-ip',
    max: 60,
    fenetreS: 60,
    message: 'Trop de consultations. Réessayez dans une minute.',
  },
  pinUtilisateur: {
    nom: 'pin-utilisateur',
    max: 5,
    fenetreS: 15 * 60,
    message: 'Trop de codes PIN essayés. Réessayez dans 15 minutes.',
  },
} satisfies Record<string, Limite>;

/**
 * Compteurs à fenêtre fixe dans Redis : partagés entre les instances de l'API
 * et conservés à son redémarrage.
 */
@Injectable()
export class LimiteurService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly prefixe: string;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6380'), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.prefixe = config.get<string>('REDIS_PREFIXE', 'gestvente');
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  /** Compte un essai ; au-delà du maximum, répond 429 avec le délai d'attente. */
  async verifier(limite: Limite, identifiant: string): Promise<void> {
    const cle = `${this.prefixe}:limite:${limite.nom}:${identifiant.toLowerCase()}`;
    const [[, compte], [, ttl]] = (await this.redis.multi().incr(cle).ttl(cle).exec()) as [
      [null, number],
      [null, number],
    ];
    if (ttl < 0) await this.redis.expire(cle, limite.fenetreS);
    if (compte > limite.max) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: limite.message,
          reessayerDansS: ttl > 0 ? ttl : limite.fenetreS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Refuse (429) si le compteur a déjà dépassé le maximum, sans compter cet essai. */
  async controler(limite: Limite, identifiant: string): Promise<void> {
    const cle = `${this.prefixe}:limite:${limite.nom}:${identifiant.toLowerCase()}`;
    const [[, compte], [, ttl]] = (await this.redis.multi().get(cle).ttl(cle).exec()) as [
      [null, string | null],
      [null, number],
    ];
    if (Number(compte ?? 0) >= limite.max) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: limite.message,
          reessayerDansS: ttl > 0 ? ttl : limite.fenetreS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Remet un compteur à zéro (ex. après un bon code PIN). */
  async reinitialiser(limite: Limite, identifiant: string): Promise<void> {
    await this.redis.del(`${this.prefixe}:limite:${limite.nom}:${identifiant.toLowerCase()}`);
  }
}
