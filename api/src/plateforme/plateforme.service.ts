import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type EtatAbonnement,
  etatAbonnement,
  finEssai,
  type FormuleAbonnement,
  PREAVIS_JOURS,
  prixPeriode,
  prolongation,
} from '@gestvente/commun';
import { hash, verify } from '@node-rs/argon2';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { installerCatalogueReference } from '../catalogue/installer-reference.js';
import type { MoyenPaiement, StatutCommerce } from '../generated/prisma/enums.js';
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

export interface NouveauPaiement {
  formule: FormuleAbonnement;
  periodes: number;
  moyen: MoyenPaiement;
  reference?: string;
  /** Montant réellement payé (remise négociée) ; par défaut, le tarif. */
  montant?: number;
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
    const maintenant = new Date();
    const depuis = new Date(maintenant.getTime() - 30 * 86_400_000);
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
        abonnement: etatAbonnement(c.abonnementJusquAu, c.essaiJusquAu, maintenant),
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
        paiementsAbonnement: { orderBy: { creeLe: 'desc' }, take: 50 },
      },
    });
    if (!commerce) throw new NotFoundException('Commerce introuvable.');
    const ouvertes = commerce.boutiques.filter((b) => !b.supprimeeLe).length;
    return {
      id: commerce.id,
      nom: commerce.nom,
      telephone: commerce.telephone,
      adresse: commerce.adresse,
      statut: commerce.statut,
      motifStatut: commerce.motifStatut,
      abonnementJusquAu: commerce.abonnementJusquAu?.toISOString() ?? null,
      essaiJusquAu: commerce.essaiJusquAu?.toISOString() ?? null,
      abonnement: etatAbonnement(commerce.abonnementJusquAu, commerce.essaiJusquAu, new Date()),
      tarifs: {
        MENSUELLE: prixPeriode('MENSUELLE', ouvertes),
        ANNUELLE: prixPeriode('ANNUELLE', ouvertes),
      },
      paiements: commerce.paiementsAbonnement.map((p) => ({
        id: p.id,
        formule: p.formule,
        periodes: p.periodes,
        montant: Number(p.montant),
        moyen: p.moyen,
        reference: p.reference,
        periodeDu: p.periodeDu.toISOString(),
        periodeAu: p.periodeAu.toISOString(),
        saisiPar: p.saisiPar,
        creeLe: p.creeLe.toISOString(),
      })),
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
        // Essai offert : l'accès court jusqu'à sa fin, sauf échéance déjà payée.
        const essai = finEssai(new Date());
        const commerce = await tx.commerce.create({
          data: {
            nom: d.commerce.trim(),
            telephone: d.telephone,
            essaiJusquAu: essai,
            abonnementJusquAu: d.abonnementJusquAu ? new Date(d.abonnementJusquAu) : essai,
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

  /** Paiement d'abonnement : prolonge l'échéance (depuis elle si elle court encore) et rouvre l'accès. */
  async enregistrerPaiement(concepteur: ConcepteurConnecte, id: string, p: NouveauPaiement) {
    if (p.moyen === 'AVOIR') throw new BadRequestException('Moyen de paiement non accepté.');
    if (p.moyen !== 'ESPECES' && !p.reference?.trim()) {
      throw new BadRequestException('La référence du paiement est obligatoire pour ce moyen.');
    }
    return this.prisma.$transaction(async (tx) => {
      // Deux paiements simultanés ne prolongent pas depuis la même échéance.
      const verrou = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Commerce" WHERE id = ${id} FOR UPDATE`;
      if (verrou.length === 0) throw new NotFoundException('Commerce introuvable.');
      const c = await tx.commerce.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { boutiques: { where: { supprimeeLe: null } } } } },
      });
      const tarif = prixPeriode(p.formule, c._count.boutiques) * p.periodes;
      const montant = p.montant ?? tarif;
      const periode = prolongation(c.abonnementJusquAu, new Date(), p.formule, p.periodes);
      const paiement = await tx.paiementAbonnement.create({
        data: {
          commerceId: id,
          formule: p.formule,
          periodes: p.periodes,
          montant: BigInt(montant),
          moyen: p.moyen,
          reference: p.reference?.trim() || null,
          periodeDu: periode.du,
          periodeAu: periode.au,
          saisiPar: concepteur.nom,
        },
      });
      await tx.commerce.update({ where: { id }, data: { abonnementJusquAu: periode.au } });
      await this.audit.journaliser(
        {
          commerceId: id,
          action: ACTIONS_AUDIT.PLATEFORME_PAIEMENT,
          details: {
            concepteur: concepteur.nom,
            formule: p.formule,
            periodes: p.periodes,
            montant,
            tarif,
            jusquAu: periode.au.toISOString(),
          },
        },
        tx,
      );
      return { id: paiement.id, montant, jusquAu: periode.au.toISOString() };
    });
  }

  /** Tableau du concepteur : commerces par état d'abonnement, encaissements, échéances proches. */
  async tableau(maintenant = new Date()) {
    const commerces = await this.prisma.commerce.findMany({
      where: { statut: { not: 'SUPPRIME' } },
      select: {
        id: true,
        nom: true,
        statut: true,
        abonnementJusquAu: true,
        essaiJusquAu: true,
        creeLe: true,
      },
    });
    const etats: Record<EtatAbonnement, number> = {
      ILLIMITE: 0,
      ESSAI: 0,
      ACTIF: 0,
      A_RENOUVELER: 0,
      EN_GRACE: 0,
      EXPIRE: 0,
    };
    const echeances: {
      id: string;
      nom: string;
      etat: EtatAbonnement;
      jusquAu: string;
      joursRestants: number;
    }[] = [];
    for (const c of commerces) {
      if (c.statut !== 'ACTIF') continue;
      const e = etatAbonnement(c.abonnementJusquAu, c.essaiJusquAu, maintenant);
      etats[e.etat] += 1;
      if (c.abonnementJusquAu && e.joursRestants !== null && e.joursRestants <= PREAVIS_JOURS) {
        echeances.push({
          id: c.id,
          nom: c.nom,
          etat: e.etat,
          jusquAu: c.abonnementJusquAu.toISOString(),
          joursRestants: e.joursRestants,
        });
      }
    }
    echeances.sort((a, b) => a.joursRestants - b.joursRestants);
    const debutMois = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
    const debutAnnee = new Date(Date.UTC(maintenant.getUTCFullYear(), 0, 1));
    const somme = async (depuis: Date) => {
      const r = await this.prisma.paiementAbonnement.aggregate({
        where: { creeLe: { gte: depuis } },
        _sum: { montant: true },
        _count: { _all: true },
      });
      return { montant: Number(r._sum.montant ?? 0n), paiements: r._count._all };
    };
    const derniers = await this.prisma.paiementAbonnement.findMany({
      orderBy: { creeLe: 'desc' },
      take: 10,
      include: { commerce: { select: { nom: true } } },
    });
    return {
      commerces: {
        total: commerces.length,
        actifs: commerces.filter((c) => c.statut === 'ACTIF').length,
        suspendus: commerces.filter((c) => c.statut === 'SUSPENDU').length,
        nouveauxCeMois: commerces.filter((c) => c.creeLe >= debutMois).length,
      },
      abonnements: etats,
      encaisse: { mois: await somme(debutMois), annee: await somme(debutAnnee) },
      echeances,
      derniersPaiements: derniers.map((p) => ({
        id: p.id,
        commerceId: p.commerceId,
        commerce: p.commerce.nom,
        formule: p.formule,
        periodes: p.periodes,
        montant: Number(p.montant),
        moyen: p.moyen,
        creeLe: p.creeLe.toISOString(),
      })),
    };
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
