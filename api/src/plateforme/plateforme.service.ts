import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { installerCatalogueReference } from '../catalogue/installer-reference.js';
import type { StatutCommerce } from '../generated/prisma/enums.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LIMITES, LimiteurService } from '../securite/limiteur.service.js';
import { JournalService } from '../sync/journal.service.js';
import type { ChargeConcepteur, ConcepteurConnecte } from './concepteur.guard.js';

/** Session du concepteur : une journée de travail. */
const DUREE_SESSION = '10h';

export interface NouveauCommerce {
  commerce: string;
  telephone: string;
  boutique: string;
  prefixe: string;
  adresse?: string;
  proprietaire: string;
  identifiant: string;
  abonnementJusquAu?: string;
}

const motDePasseProvisoire = () => randomBytes(12).toString('base64url');

/**
 * Espace concepteur : commerces abonnés, leurs boutiques, verrouillage et retrait.
 * Le concepteur ne voit ni les ventes ni les clients : seulement des compteurs.
 * Rien n'est jamais effacé : un retrait se restaure.
 */
@Injectable()
export class PlateformeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly limiteur: LimiteurService,
    private readonly audit: AuditService,
    private readonly journal: JournalService,
  ) {}

  async connexion(identifiantSaisi: string, motDePasse: string) {
    const identifiant = identifiantSaisi.trim().toLowerCase();
    await this.limiteur.verifier(LIMITES.connexionIdentifiant, `concepteur:${identifiant}`);
    const concepteur = await this.prisma.concepteur.findUnique({ where: { identifiant } });
    const valide = concepteur ? await verify(concepteur.motDePasseHash, motDePasse) : false;
    if (!concepteur || !valide || !concepteur.actif) {
      throw new UnauthorizedException('Identifiant ou mot de passe incorrect.');
    }
    await this.limiteur.reinitialiser(LIMITES.connexionIdentifiant, `concepteur:${identifiant}`);
    await this.prisma.concepteur.update({
      where: { id: concepteur.id },
      data: { derniereConnexion: new Date() },
    });
    const charge: ChargeConcepteur = { type: 'concepteur', sub: concepteur.id };
    return {
      jeton: await this.jwt.signAsync(charge, { expiresIn: DUREE_SESSION }),
      concepteur: { nom: concepteur.nom },
    };
  }

  /** Commerces avec leurs compteurs (boutiques, comptes, produits, activité). */
  async commerces(recherche?: string, statut?: StatutCommerce) {
    const commerces = await this.prisma.commerce.findMany({
      where: {
        ...(statut ? { statut } : { statut: { not: 'SUPPRIME' } }),
        ...(recherche ? { nom: { contains: recherche, mode: 'insensitive' } } : {}),
      },
      include: {
        boutiques: { select: { id: true, verrouillee: true, supprimeeLe: true } },
        utilisateurs: {
          where: { role: Role.PROPRIETAIRE },
          select: { nom: true, identifiant: true, derniereConnexion: true },
        },
        _count: { select: { utilisateurs: true, produits: true } },
      },
      orderBy: { creeLe: 'desc' },
    });
    const depuis = new Date(Date.now() - 30 * 86_400_000);
    const activite = await this.prisma.vente.groupBy({
      by: ['commerceId'],
      where: { commerceId: { in: commerces.map((c) => c.id) }, dateVente: { gte: depuis } },
      _count: { _all: true },
      _max: { dateVente: true },
    });
    return commerces.map((c) => {
      const a = activite.find((x) => x.commerceId === c.id);
      const visibles = c.boutiques.filter((b) => !b.supprimeeLe);
      return {
        id: c.id,
        nom: c.nom,
        telephone: c.telephone,
        statut: c.statut,
        motifStatut: c.motifStatut,
        abonnementJusquAu: c.abonnementJusquAu?.toISOString() ?? null,
        creeLe: c.creeLe.toISOString(),
        proprietaire: c.utilisateurs[0] ?? null,
        boutiques: visibles.length,
        boutiquesVerrouillees: visibles.filter((b) => b.verrouillee).length,
        utilisateurs: c._count.utilisateurs,
        produits: c._count.produits,
        ventes30Jours: a?._count._all ?? 0,
        derniereVente: a?._max.dateVente?.toISOString() ?? null,
      };
    });
  }

  async commerce(id: string) {
    const commerce = await this.prisma.commerce.findUnique({
      where: { id },
      include: {
        boutiques: { orderBy: { creeLe: 'asc' } },
        utilisateurs: {
          select: {
            id: true,
            nom: true,
            identifiant: true,
            role: true,
            actif: true,
            derniereConnexion: true,
          },
          orderBy: { nom: 'asc' },
        },
        _count: { select: { produits: true, clients: true } },
      },
    });
    if (!commerce) throw new NotFoundException('Commerce introuvable.');
    return {
      id: commerce.id,
      nom: commerce.nom,
      telephone: commerce.telephone,
      adresse: commerce.adresse,
      statut: commerce.statut,
      motifStatut: commerce.motifStatut,
      abonnementJusquAu: commerce.abonnementJusquAu?.toISOString() ?? null,
      creeLe: commerce.creeLe.toISOString(),
      produits: commerce._count.produits,
      clients: commerce._count.clients,
      boutiques: commerce.boutiques.map((b) => ({
        id: b.id,
        nom: b.nom,
        prefixe: b.prefixe,
        adresse: b.adresse,
        telephone: b.telephone,
        verrouillee: b.verrouillee,
        supprimeeLe: b.supprimeeLe?.toISOString() ?? null,
      })),
      utilisateurs: commerce.utilisateurs.map((u) => ({
        ...u,
        derniereConnexion: u.derniereConnexion?.toISOString() ?? null,
      })),
    };
  }

  /** Nouveau commerçant : commerce, première boutique, propriétaire, catalogue de base. */
  async creerCommerce(concepteur: ConcepteurConnecte, d: NouveauCommerce) {
    const identifiant = d.identifiant.trim().toLowerCase();
    if (await this.prisma.utilisateur.findUnique({ where: { identifiant } })) {
      throw new ConflictException(`L’identifiant « ${identifiant} » est déjà utilisé.`);
    }
    const motDePasse = motDePasseProvisoire();
    const motDePasseHash = await hash(motDePasse);
    const resultat = await this.prisma.$transaction(
      async (tx) => {
        const commerce = await tx.commerce.create({
          data: {
            nom: d.commerce.trim(),
            telephone: d.telephone,
            abonnementJusquAu: d.abonnementJusquAu ? new Date(d.abonnementJusquAu) : null,
          },
        });
        const boutique = await tx.boutique.create({
          data: {
            commerceId: commerce.id,
            nom: d.boutique.trim(),
            prefixe: d.prefixe.toUpperCase(),
            adresse: d.adresse?.trim() || null,
            telephone: d.telephone,
          },
        });
        await tx.utilisateur.create({
          data: {
            commerceId: commerce.id,
            nom: d.proprietaire.trim(),
            identifiant,
            role: Role.PROPRIETAIRE,
            motDePasseHash,
            boutiques: { create: [{ boutiqueId: boutique.id }] },
          },
        });
        const catalogue = await installerCatalogueReference(tx, commerce.id);
        await this.audit.journaliser(
          {
            commerceId: commerce.id,
            action: ACTIONS_AUDIT.PLATEFORME_COMMERCE_CREE,
            details: { concepteur: concepteur.nom, produits: catalogue.produits },
          },
          tx,
        );
        return { commerceId: commerce.id, produits: catalogue.produits };
      },
      { timeout: 60_000 },
    );
    return { ...resultat, identifiant, motDePasse };
  }

  async changerStatut(
    concepteur: ConcepteurConnecte,
    id: string,
    statut: StatutCommerce,
    motif: string | null,
  ) {
    const commerce = await this.prisma.commerce.findUnique({ where: { id } });
    if (!commerce) throw new NotFoundException('Commerce introuvable.');
    await this.prisma.commerce.update({
      where: { id },
      data: {
        statut,
        motifStatut: statut === 'ACTIF' ? null : motif?.trim() || null,
        statutModifieLe: new Date(),
      },
    });
    await this.audit.journaliser({
      commerceId: id,
      action: ACTIONS_AUDIT.PLATEFORME_STATUT_COMMERCE,
      details: { concepteur: concepteur.nom, avant: commerce.statut, apres: statut, motif },
    });
  }

  async modifierAbonnement(concepteur: ConcepteurConnecte, id: string, jusquAu: string | null) {
    await this.prisma.commerce.update({
      where: { id },
      data: { abonnementJusquAu: jusquAu ? new Date(jusquAu) : null },
    });
    await this.audit.journaliser({
      commerceId: id,
      action: ACTIONS_AUDIT.PLATEFORME_ABONNEMENT,
      details: { concepteur: concepteur.nom, jusquAu },
    });
  }

  async ajouterBoutique(
    concepteur: ConcepteurConnecte,
    commerceId: string,
    d: { nom: string; prefixe: string; adresse?: string; telephone?: string },
  ) {
    const prefixe = d.prefixe.toUpperCase();
    if (await this.prisma.boutique.findFirst({ where: { commerceId, prefixe } })) {
      throw new ConflictException(`Le préfixe ${prefixe} est déjà pris dans ce commerce.`);
    }
    // Les boutiques arrivent sur les appareils avec le profil (reconnexion ou actualisation).
    const boutique = await this.prisma.boutique.create({
      data: {
        commerceId,
        nom: d.nom.trim(),
        prefixe,
        adresse: d.adresse?.trim() || null,
        telephone: d.telephone ?? null,
      },
    });
    await this.audit.journaliser({
      commerceId,
      boutiqueId: boutique.id,
      action: ACTIONS_AUDIT.PLATEFORME_BOUTIQUE,
      details: { concepteur: concepteur.nom, action: 'creation', nom: boutique.nom },
    });
    return { id: boutique.id };
  }

  /** Verrouiller ou déverrouiller, retirer ou restaurer une boutique. */
  async modifierBoutique(
    concepteur: ConcepteurConnecte,
    id: string,
    changement: { verrouillee?: boolean; supprimee?: boolean },
  ) {
    const boutique = await this.prisma.boutique.findUnique({ where: { id } });
    if (!boutique) throw new NotFoundException('Boutique introuvable.');
    if (changement.verrouillee === undefined && changement.supprimee === undefined) {
      throw new BadRequestException('Rien à modifier.');
    }
    await this.prisma.boutique.update({
      where: { id },
      data: {
        ...(changement.verrouillee !== undefined ? { verrouillee: changement.verrouillee } : {}),
        ...(changement.supprimee !== undefined
          ? { supprimeeLe: changement.supprimee ? new Date() : null }
          : {}),
      },
    });
    await this.audit.journaliser({
      commerceId: boutique.commerceId,
      boutiqueId: id,
      action: ACTIONS_AUDIT.PLATEFORME_BOUTIQUE,
      details: { concepteur: concepteur.nom, ...changement, nom: boutique.nom },
    });
  }

  /** Complète le catalogue du commerce avec le catalogue de base (sans rien remplacer). */
  async installerCatalogue(concepteur: ConcepteurConnecte, commerceId: string) {
    if (!(await this.prisma.commerce.findUnique({ where: { id: commerceId } }))) {
      throw new NotFoundException('Commerce introuvable.');
    }
    const bilan = await this.prisma.$transaction(
      async (tx) => {
        await this.journal.verrouiller(tx, commerceId);
        const b = await installerCatalogueReference(tx, commerceId);
        await this.journal.ecrire(tx, commerceId, b.changements);
        return b;
      },
      { timeout: 60_000 },
    );
    await this.audit.journaliser({
      commerceId,
      action: ACTIONS_AUDIT.PLATEFORME_CATALOGUE,
      details: { concepteur: concepteur.nom, produits: bilan.produits, modeles: bilan.modeles },
    });
    const { changements: _, ...compteurs } = bilan;
    return compteurs;
  }

  /** Nouveau mot de passe provisoire du propriétaire (affiché une fois). */
  async reinitialiserProprietaire(concepteur: ConcepteurConnecte, commerceId: string) {
    const proprietaire = await this.prisma.utilisateur.findFirst({
      where: { commerceId, role: Role.PROPRIETAIRE },
      orderBy: { creeLe: 'asc' },
    });
    if (!proprietaire) throw new NotFoundException('Aucun propriétaire pour ce commerce.');
    const motDePasse = motDePasseProvisoire();
    await this.prisma.utilisateur.update({
      where: { id: proprietaire.id },
      data: { motDePasseHash: await hash(motDePasse), actif: true },
    });
    await this.audit.journaliser({
      commerceId,
      action: ACTIONS_AUDIT.PLATEFORME_MOT_DE_PASSE,
      utilisateurId: proprietaire.id,
      details: { concepteur: concepteur.nom },
    });
    return { identifiant: proprietaire.identifiant, motDePasse };
  }
}
