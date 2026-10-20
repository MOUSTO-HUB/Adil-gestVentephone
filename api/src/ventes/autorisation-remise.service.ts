import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { plafondRemise } from '@gestvente/commun';
import { verify } from '@node-rs/argon2';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { peutAccederBoutique } from '../auth/acces.regles.js';
import { normaliserIdentifiant } from '../auth/auth.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LIMITES, LimiteurService } from '../securite/limiteur.service.js';

/** Contenu du jeton : un gérant a validé, en personne, une remise jusqu'à `plafond` %. */
export interface ChargeAutorisationRemise {
  type: 'autorisation-remise';
  commerceId: string;
  boutiqueId: string;
  gerantId: string;
  plafond: number;
}

/** Validité du jeton : la vente doit être faite dans ce délai (elle peut être envoyée plus tard). */
export const DUREE_AUTORISATION = '2h';

/**
 * Validation d'une remise au-delà du plafond du vendeur : le gérant saisit son
 * identifiant et son code PIN sur l'appareil du vendeur (en ligne). Le serveur
 * renvoie un jeton signé, joint à la vente, qu'il vérifiera à son arrivée.
 */
@Injectable()
export class AutorisationRemiseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly limiteur: LimiteurService,
    private readonly audit: AuditService,
  ) {}

  async autoriser(
    demandeur: UtilisateurConnecte,
    boutiqueId: string,
    identifiant: string,
    pin: string,
    pourcentage: number,
  ): Promise<{ jeton: string; gerant: string; plafond: number }> {
    const gerant = await this.prisma.utilisateur.findFirst({
      where: {
        identifiant: normaliserIdentifiant(identifiant),
        commerceId: demandeur.commerceId,
        actif: true,
      },
      include: { boutiques: true, commerce: true },
    });
    const refus = 'Identifiant ou code PIN du gérant incorrect.';
    if (!gerant) throw new UnauthorizedException(refus);
    await this.limiteur.verifier(LIMITES.pinUtilisateur, gerant.id);
    if (!gerant.pinHash || !(await verify(gerant.pinHash, pin.trim()))) {
      throw new UnauthorizedException(refus);
    }
    await this.limiteur.reinitialiser(LIMITES.pinUtilisateur, gerant.id);
    if (gerant.role === Role.VENDEUR) {
      throw new ForbiddenException('Seul un gérant ou le propriétaire peut valider une remise.');
    }
    const acteur = {
      id: gerant.id,
      role: gerant.role,
      commerceId: gerant.commerceId,
      boutiqueIds: gerant.boutiques.map((b) => b.boutiqueId),
    };
    if (!peutAccederBoutique(acteur, { id: boutiqueId, commerceId: demandeur.commerceId })) {
      throw new ForbiddenException('Ce gérant n’est pas rattaché à cette boutique.');
    }
    const plafond = plafondRemise(gerant.role, gerant.commerce);
    if (pourcentage > plafond) {
      throw new ForbiddenException(`Ce gérant accorde au plus ${plafond} % de remise.`);
    }
    const charge: ChargeAutorisationRemise = {
      type: 'autorisation-remise',
      commerceId: demandeur.commerceId,
      boutiqueId,
      gerantId: gerant.id,
      plafond,
    };
    await this.audit.journaliser({
      commerceId: demandeur.commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.REMISE_AUTORISEE,
      utilisateurId: gerant.id,
      appareilId: demandeur.appareilId,
      details: { demandeur: demandeur.id, pourcentage },
    });
    return {
      jeton: await this.jwt.signAsync(charge, { expiresIn: DUREE_AUTORISATION }),
      gerant: gerant.nom,
      plafond,
    };
  }

  /**
   * Plafond accordé par un jeton, s'il est authentique, pour ce commerce et cette
   * boutique, et valide au moment de la vente (pas au moment de son envoi).
   */
  async plafondAutorise(
    jeton: string | null,
    commerceId: string,
    boutiqueId: string,
    dateVente: Date,
  ): Promise<{ plafond: number; gerantId: string } | null> {
    if (!jeton) return null;
    try {
      const charge = await this.jwt.verifyAsync<
        ChargeAutorisationRemise & { exp: number; iat: number }
      >(jeton, {
        ignoreExpiration: true,
      });
      const valide =
        charge.type === 'autorisation-remise' &&
        charge.commerceId === commerceId &&
        charge.boutiqueId === boutiqueId &&
        dateVente.getTime() <= charge.exp * 1000 &&
        // Une marge de 5 minutes pour l'horloge de l'appareil.
        dateVente.getTime() >= charge.iat * 1000 - 5 * 60 * 1000;
      return valide ? { plafond: charge.plafond, gerantId: charge.gerantId } : null;
    } catch {
      return null;
    }
  }
}
