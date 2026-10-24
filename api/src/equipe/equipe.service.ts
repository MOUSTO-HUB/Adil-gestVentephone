import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { BOUTIQUE_OUVERTE } from '../auth/acces.regles.js';
import { normaliserIdentifiant } from '../auth/auth.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

const motDePasseProvisoire = () => randomBytes(12).toString('base64url');

export interface NouvelleBoutique {
  nom: string;
  prefixe: string;
  adresse?: string | null;
  telephone?: string | null;
}

export interface NouvelEmploye {
  nom: string;
  identifiant: string;
  telephone?: string | null;
  role: 'GERANT' | 'VENDEUR';
  boutiqueIds: string[];
}

export interface ModificationEmploye {
  nom?: string;
  telephone?: string | null;
  role?: 'GERANT' | 'VENDEUR';
  boutiqueIds?: string[];
  actif?: boolean;
}

/**
 * Boutiques et employés d'un commerce, gérés par le propriétaire : chaque employé est
 * rattaché à une ou plusieurs boutiques ; il ne voit et ne synchronise que celles-ci.
 * Le gérant consulte l'équipe de ses boutiques.
 */
@Injectable()
export class EquipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Boutiques ─────────────────────────────────────────────────────────────

  boutiquesDuCommerce(commerceId: string) {
    return this.prisma.boutique.findMany({
      where: { commerceId, ...BOUTIQUE_OUVERTE },
      select: { id: true, nom: true, prefixe: true },
      orderBy: { nom: 'asc' },
    });
  }

  async creerBoutique(acteur: UtilisateurConnecte, d: NouvelleBoutique) {
    const prefixe = d.prefixe.trim().toUpperCase();
    if (
      await this.prisma.boutique.findFirst({ where: { commerceId: acteur.commerceId, prefixe } })
    ) {
      throw new ConflictException(`Le préfixe ${prefixe} est déjà pris par une autre boutique.`);
    }
    const boutique = await this.prisma.boutique.create({
      data: {
        commerceId: acteur.commerceId,
        nom: d.nom.trim(),
        prefixe,
        adresse: d.adresse?.trim() || null,
        telephone: d.telephone ?? null,
      },
    });
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      boutiqueId: boutique.id,
      action: ACTIONS_AUDIT.BOUTIQUE_CREEE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Boutique',
      entiteId: boutique.id,
      details: { nom: boutique.nom, prefixe },
    });
    return { id: boutique.id, nom: boutique.nom, prefixe: boutique.prefixe };
  }

  /** Nom et coordonnées (le préfixe des factures ne change pas : numéros déjà émis). */
  async modifierBoutique(
    acteur: UtilisateurConnecte,
    boutiqueId: string,
    d: { nom?: string; adresse?: string | null; telephone?: string | null },
  ) {
    const boutique = await this.prisma.boutique.findFirst({
      where: { id: boutiqueId, commerceId: acteur.commerceId, supprimeeLe: null },
    });
    if (!boutique) throw new NotFoundException('Boutique introuvable.');
    const apres = await this.prisma.boutique.update({
      where: { id: boutiqueId },
      data: {
        ...(d.nom !== undefined ? { nom: d.nom.trim() } : {}),
        ...(d.adresse !== undefined ? { adresse: d.adresse?.trim() || null } : {}),
        ...(d.telephone !== undefined ? { telephone: d.telephone } : {}),
      },
    });
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.BOUTIQUE_MODIFIEE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Boutique',
      entiteId: boutiqueId,
      details: {
        avant: { nom: boutique.nom, adresse: boutique.adresse, telephone: boutique.telephone },
        apres: { nom: apres.nom, adresse: apres.adresse, telephone: apres.telephone },
      },
    });
  }

  // ─── Employés ──────────────────────────────────────────────────────────────

  /** Propriétaire : toute l'équipe ; gérant : les employés de ses boutiques. */
  async employes(acteur: UtilisateurConnecte) {
    const utilisateurs = await this.prisma.utilisateur.findMany({
      where: {
        commerceId: acteur.commerceId,
        ...(acteur.role === Role.PROPRIETAIRE
          ? {}
          : {
              role: { not: Role.PROPRIETAIRE },
              boutiques: { some: { boutiqueId: { in: acteur.boutiqueIds } } },
            }),
      },
      include: {
        boutiques: { select: { boutiqueId: true } },
        appareils: { where: { revoqueLe: null }, select: { id: true } },
      },
      orderBy: [{ actif: 'desc' }, { nom: 'asc' }],
    });
    return utilisateurs.map((u) => ({
      id: u.id,
      nom: u.nom,
      identifiant: u.identifiant,
      telephone: u.telephone,
      role: u.role,
      actif: u.actif,
      // Un gérant ne voit que les rattachements à ses propres boutiques.
      boutiqueIds: u.boutiques
        .map((b) => b.boutiqueId)
        .filter((id) => acteur.role === Role.PROPRIETAIRE || acteur.boutiqueIds.includes(id)),
      appareils: u.appareils.length,
      derniereConnexion: u.derniereConnexion?.toISOString() ?? null,
    }));
  }

  private async verifierBoutiques(commerceId: string, boutiqueIds: string[]) {
    const ids = [...new Set(boutiqueIds)];
    if (!ids.length) throw new BadRequestException('Rattachez l’employé à au moins une boutique.');
    const trouvees = await this.prisma.boutique.count({
      where: { id: { in: ids }, commerceId, ...BOUTIQUE_OUVERTE },
    });
    if (trouvees !== ids.length) throw new BadRequestException('Boutique inconnue ou fermée.');
    return ids;
  }

  async creerEmploye(acteur: UtilisateurConnecte, d: NouvelEmploye) {
    const identifiant = normaliserIdentifiant(d.identifiant);
    if (await this.prisma.utilisateur.findUnique({ where: { identifiant } })) {
      throw new ConflictException(`L’identifiant « ${identifiant} » est déjà utilisé.`);
    }
    const boutiqueIds = await this.verifierBoutiques(acteur.commerceId, d.boutiqueIds);
    const motDePasse = motDePasseProvisoire();
    const employe = await this.prisma.utilisateur.create({
      data: {
        commerceId: acteur.commerceId,
        nom: d.nom.trim(),
        identifiant,
        telephone: d.telephone ?? null,
        motDePasseHash: await hash(motDePasse),
        role: d.role,
        creeParId: acteur.id,
        boutiques: { create: boutiqueIds.map((boutiqueId) => ({ boutiqueId })) },
      },
    });
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      action: ACTIONS_AUDIT.EMPLOYE_CREE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Utilisateur',
      entiteId: employe.id,
      details: { nom: employe.nom, identifiant, role: d.role, boutiqueIds },
    });
    return { id: employe.id, identifiant, motDePasse };
  }

  private async employe(acteur: UtilisateurConnecte, id: string) {
    const employe = await this.prisma.utilisateur.findFirst({
      where: { id, commerceId: acteur.commerceId },
      include: { boutiques: { select: { boutiqueId: true } } },
    });
    if (!employe) throw new NotFoundException('Employé introuvable.');
    if (employe.role === Role.PROPRIETAIRE) {
      throw new ForbiddenException('Le compte du propriétaire se gère avec la plateforme.');
    }
    return employe;
  }

  /**
   * Rôle, rattachements, activation. Un employé désactivé est déconnecté de tous ses
   * appareils ; un rattachement retiré prend effet à la requête suivante (les données
   * de la boutique quittent ses appareils à la synchronisation).
   */
  async modifierEmploye(acteur: UtilisateurConnecte, id: string, d: ModificationEmploye) {
    const avant = await this.employe(acteur, id);
    const boutiqueIds = d.boutiqueIds
      ? await this.verifierBoutiques(acteur.commerceId, d.boutiqueIds)
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.utilisateur.update({
        where: { id },
        data: {
          ...(d.nom !== undefined ? { nom: d.nom.trim() } : {}),
          ...(d.telephone !== undefined ? { telephone: d.telephone } : {}),
          ...(d.role !== undefined ? { role: d.role } : {}),
          ...(d.actif !== undefined ? { actif: d.actif } : {}),
        },
      });
      if (boutiqueIds) {
        await tx.utilisateurBoutique.deleteMany({ where: { utilisateurId: id } });
        await tx.utilisateurBoutique.createMany({
          data: boutiqueIds.map((boutiqueId) => ({ utilisateurId: id, boutiqueId })),
        });
      }
      if (d.actif === false) {
        await tx.appareil.updateMany({
          where: { utilisateurId: id, revoqueLe: null },
          data: { revoqueLe: new Date(), revoqueParId: acteur.id, jetonHash: null },
        });
      }
    });
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      action: ACTIONS_AUDIT.EMPLOYE_MODIFIE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Utilisateur',
      entiteId: id,
      details: {
        avant: {
          nom: avant.nom,
          role: avant.role,
          actif: avant.actif,
          boutiqueIds: avant.boutiques.map((b) => b.boutiqueId),
        },
        apres: { ...d, ...(boutiqueIds ? { boutiqueIds } : {}) },
      },
    });
  }

  /** Mot de passe oublié : nouveau mot de passe provisoire, appareils déconnectés. */
  async reinitialiserMotDePasse(acteur: UtilisateurConnecte, id: string) {
    const employe = await this.employe(acteur, id);
    const motDePasse = motDePasseProvisoire();
    await this.prisma.$transaction([
      this.prisma.utilisateur.update({
        where: { id },
        data: { motDePasseHash: await hash(motDePasse) },
      }),
      this.prisma.appareil.updateMany({
        where: { utilisateurId: id, revoqueLe: null },
        data: { revoqueLe: new Date(), revoqueParId: acteur.id, jetonHash: null },
      }),
    ]);
    await this.audit.journaliser({
      commerceId: acteur.commerceId,
      action: ACTIONS_AUDIT.MOT_DE_PASSE_REINITIALISE,
      utilisateurId: acteur.id,
      appareilId: acteur.appareilId,
      entite: 'Utilisateur',
      entiteId: id,
    });
    return { identifiant: employe.identifiant, motDePasse };
  }
}
