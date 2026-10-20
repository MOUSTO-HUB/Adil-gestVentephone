import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { type Acteur, peutGererSessionsDe } from '../auth/acces.regles.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppareilDto, ResultatDeconnexionDto } from './appareils.dto.js';

const MESSAGE_INTERDIT = 'Vous ne pouvez pas déconnecter les appareils de cette personne.';

/** Appareils connectés du commerce et déconnexion à distance (appareil perdu, employé parti). */
@Injectable()
export class AppareilsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Appareils encore connectés que l'utilisateur peut gérer. */
  async lister(acteur: UtilisateurConnecte): Promise<AppareilDto[]> {
    const appareils = await this.prisma.appareil.findMany({
      where: { commerceId: acteur.commerceId, revoqueLe: null },
      include: {
        utilisateur: {
          select: {
            id: true,
            nom: true,
            role: true,
            commerceId: true,
            boutiques: { select: { boutiqueId: true } },
          },
        },
      },
      orderBy: [{ dernierAcces: 'desc' }],
    });
    return appareils
      .filter((a) => peutGererSessionsDe(acteur, this.acteur(a.utilisateur)))
      .map((a) => ({
        id: a.id,
        nom: a.nom,
        plateforme: a.plateforme,
        dernierAcces: a.dernierAcces,
        creeLe: a.creeLe,
        courant: a.id === acteur.appareilId,
        utilisateur: { id: a.utilisateur.id, nom: a.utilisateur.nom, role: a.utilisateur.role },
      }));
  }

  /** Déconnecte un appareil : ses jetons ne valent plus rien, aussitôt. */
  async deconnecterAppareil(acteur: UtilisateurConnecte, appareilId: string): Promise<void> {
    const appareil = await this.prisma.appareil.findFirst({
      where: { id: appareilId, commerceId: acteur.commerceId },
      select: { id: true, nom: true, revoqueLe: true, utilisateurId: true },
    });
    if (!appareil) throw new NotFoundException('Appareil introuvable.');
    await this.verifierDroit(acteur, appareil.utilisateurId);
    if (appareil.revoqueLe) return;
    await this.revoquer(acteur, [appareil.id]);
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      action: ACTIONS_AUDIT.DECONNEXION_A_DISTANCE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Appareil',
      entiteId: appareil.id,
      details: { appareil: appareil.nom, titulaireId: appareil.utilisateurId },
    });
  }

  /** Déconnecte tous les appareils d'un employé. */
  async deconnecterUtilisateur(
    acteur: UtilisateurConnecte,
    utilisateurId: string,
  ): Promise<ResultatDeconnexionDto> {
    await this.verifierDroit(acteur, utilisateurId);
    const appareils = await this.prisma.appareil.findMany({
      where: { utilisateurId, revoqueLe: null },
      select: { id: true },
    });
    await this.revoquer(
      acteur,
      appareils.map((a) => a.id),
    );
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      action: ACTIONS_AUDIT.DECONNEXION_A_DISTANCE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Utilisateur',
      entiteId: utilisateurId,
      details: { appareils: appareils.length },
    });
    return { appareils: appareils.length };
  }

  private async verifierDroit(acteur: UtilisateurConnecte, titulaireId: string): Promise<void> {
    const titulaire = await this.prisma.utilisateur.findFirst({
      where: { id: titulaireId, commerceId: acteur.commerceId },
      select: {
        id: true,
        role: true,
        commerceId: true,
        boutiques: { select: { boutiqueId: true } },
      },
    });
    if (!titulaire) throw new NotFoundException('Utilisateur introuvable.');
    if (!peutGererSessionsDe(acteur, this.acteur(titulaire))) {
      throw new ForbiddenException(MESSAGE_INTERDIT);
    }
  }

  private async revoquer(acteur: UtilisateurConnecte, ids: string[]): Promise<void> {
    await this.prisma.appareil.updateMany({
      where: { id: { in: ids }, revoqueLe: null },
      data: { revoqueLe: new Date(), revoqueParId: acteur.id, jetonHash: null },
    });
  }

  private acteur(u: {
    id: string;
    role: Role;
    commerceId: string;
    boutiques: { boutiqueId: string }[];
  }): Acteur {
    return {
      id: u.id,
      role: u.role,
      commerceId: u.commerceId,
      boutiqueIds: u.boutiques.map((b) => b.boutiqueId),
    };
  }
}
