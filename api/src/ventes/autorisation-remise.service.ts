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

/** Contenu du jeton : un gérant a validé, en personne, le retour d'une vente. */
export interface ChargeAutorisationRetour {
  type: 'autorisation-retour';
  commerceId: string;
  boutiqueId: string;
  gerantId: string;
  venteId: string;
}

/** Contenu du jeton : un gérant a validé, en personne, la reprise d'un appareil jusqu'à `valeur`. */
export interface ChargeAutorisationReprise {
  type: 'autorisation-reprise';
  commerceId: string;
  boutiqueId: string;
  gerantId: string;
  trocId: string;
  valeur: number;
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

  /** Identifiant et PIN d'un gérant (ou du propriétaire) rattaché à la boutique. */
  private async verifierGerant(
    demandeur: UtilisateurConnecte,
    boutiqueId: string,
    identifiant: string,
    pin: string,
    action: string,
  ) {
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
      throw new ForbiddenException(`Seul un gérant ou le propriétaire peut valider ${action}.`);
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
    return gerant;
  }

  async autoriser(
    demandeur: UtilisateurConnecte,
    boutiqueId: string,
    identifiant: string,
    pin: string,
    pourcentage: number,
  ): Promise<{ jeton: string; gerant: string; plafond: number }> {
    const gerant = await this.verifierGerant(demandeur, boutiqueId, identifiant, pin, 'une remise');
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
   * Retour ou échange fait par un vendeur : le gérant valide en personne avec son PIN
   * (en ligne) ; le jeton, joint au retour, n'est valable que pour cette vente.
   */
  async autoriserRetour(
    demandeur: UtilisateurConnecte,
    boutiqueId: string,
    identifiant: string,
    pin: string,
    venteId: string,
  ): Promise<{ jeton: string; gerant: string }> {
    const gerant = await this.verifierGerant(demandeur, boutiqueId, identifiant, pin, 'un retour');
    const charge: ChargeAutorisationRetour = {
      type: 'autorisation-retour',
      commerceId: demandeur.commerceId,
      boutiqueId,
      gerantId: gerant.id,
      venteId,
    };
    await this.audit.journaliser({
      commerceId: demandeur.commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.RETOUR_AUTORISE,
      utilisateurId: gerant.id,
      appareilId: demandeur.appareilId,
      entite: 'Vente',
      entiteId: venteId,
      details: { demandeur: demandeur.id },
    });
    return {
      jeton: await this.jwt.signAsync(charge, { expiresIn: DUREE_AUTORISATION }),
      gerant: gerant.nom,
    };
  }

  /** Gérant qui a validé le retour de cette vente, si le jeton est valable à la date du retour. */
  async retourAutorise(
    jeton: string | null,
    commerceId: string,
    boutiqueId: string,
    venteId: string,
    dateRetour: Date,
  ): Promise<string | null> {
    const charge = await this.lire<ChargeAutorisationRetour>(jeton, dateRetour);
    return charge?.type === 'autorisation-retour' &&
      charge.commerceId === commerceId &&
      charge.boutiqueId === boutiqueId &&
      charge.venteId === venteId
      ? charge.gerantId
      : null;
  }

  /** Jeton authentique et valable à la date de l'opération (pas à celle de son envoi). */
  private async lire<T>(jeton: string | null, date: Date): Promise<T | null> {
    if (!jeton) return null;
    try {
      const charge = await this.jwt.verifyAsync<T & { exp: number; iat: number }>(jeton, {
        ignoreExpiration: true,
      });
      const valide =
        date.getTime() <= charge.exp * 1000 &&
        // Une marge de 5 minutes pour l'horloge de l'appareil.
        date.getTime() >= charge.iat * 1000 - 5 * 60 * 1000;
      return valide ? charge : null;
    } catch {
      return null;
    }
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
    const charge = await this.lire<ChargeAutorisationRemise>(jeton, dateVente);
    return charge?.type === 'autorisation-remise' &&
      charge.commerceId === commerceId &&
      charge.boutiqueId === boutiqueId
      ? { plafond: charge.plafond, gerantId: charge.gerantId }
      : null;
  }

  /**
   * Troc fait par un vendeur au-delà de sa limite : le gérant valide en personne la
   * valeur de reprise (en ligne) ; le jeton n'est valable que pour ce troc.
   */
  async autoriserReprise(
    demandeur: UtilisateurConnecte,
    boutiqueId: string,
    identifiant: string,
    pin: string,
    trocId: string,
    valeur: number,
  ): Promise<{ jeton: string; gerant: string; valeur: number }> {
    const gerant = await this.verifierGerant(
      demandeur,
      boutiqueId,
      identifiant,
      pin,
      'une reprise',
    );
    const charge: ChargeAutorisationReprise = {
      type: 'autorisation-reprise',
      commerceId: demandeur.commerceId,
      boutiqueId,
      gerantId: gerant.id,
      trocId,
      valeur,
    };
    await this.audit.journaliser({
      commerceId: demandeur.commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.REPRISE_AUTORISEE,
      utilisateurId: gerant.id,
      appareilId: demandeur.appareilId,
      entite: 'Troc',
      entiteId: trocId,
      details: { demandeur: demandeur.id, valeur },
    });
    return {
      jeton: await this.jwt.signAsync(charge, { expiresIn: DUREE_AUTORISATION }),
      gerant: gerant.nom,
      valeur,
    };
  }

  /** Valeur de reprise validée pour ce troc (et par qui), si le jeton est valable à sa date. */
  async repriseAutorisee(
    jeton: string | null,
    commerceId: string,
    boutiqueId: string,
    trocId: string,
    date: Date,
  ): Promise<{ valeur: number; gerantId: string } | null> {
    const charge = await this.lire<ChargeAutorisationReprise>(jeton, date);
    return charge?.type === 'autorisation-reprise' &&
      charge.commerceId === commerceId &&
      charge.boutiqueId === boutiqueId &&
      charge.trocId === trocId
      ? { valeur: charge.valeur, gerantId: charge.gerantId }
      : null;
  }
}
