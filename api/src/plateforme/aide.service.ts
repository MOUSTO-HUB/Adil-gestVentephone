import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ipRequete } from '../securite/contexte-requete.js';
import type { ConcepteurConnecte } from './concepteur.guard.js';

const motDePasseProvisoire = () => randomBytes(12).toString('base64url');

/** Contact du concepteur montré aux commerçants (écran « Mot de passe oublié »). */
export interface ContactConcepteur {
  nom: string | null;
  telephone: string | null;
  whatsapp: string | null;
  email: string | null;
}

const CLE_CONTACT = 'contact-concepteur';
const CONTACT_VIDE: ContactConcepteur = { nom: null, telephone: null, whatsapp: null, email: null };

/** Réponse identique que le compte existe ou non : l'identifiant ne se devine pas ainsi. */
export const REPONSE_DEMANDE = {
  envoyee: true,
  message:
    'Demande envoyée au concepteur. Il vous donnera un nouveau mot de passe ; vous pouvez aussi le contacter directement.',
};

/**
 * Mot de passe oublié des commerçants : la demande arrive dans l'espace concepteur, qui
 * donne un nouveau mot de passe provisoire (affiché une fois) ; contact du concepteur.
 */
@Injectable()
export class AideConnexionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async contact(): Promise<ContactConcepteur> {
    const reglage = await this.prisma.reglagePlateforme.findUnique({ where: { cle: CLE_CONTACT } });
    if (!reglage) return CONTACT_VIDE;
    try {
      return { ...CONTACT_VIDE, ...(JSON.parse(reglage.valeur) as Partial<ContactConcepteur>) };
    } catch {
      return CONTACT_VIDE;
    }
  }

  async modifierContact(contact: ContactConcepteur): Promise<ContactConcepteur> {
    const propre: ContactConcepteur = {
      nom: contact.nom?.trim() || null,
      telephone: contact.telephone?.trim() || null,
      whatsapp: contact.whatsapp?.trim() || null,
      email: contact.email?.trim() || null,
    };
    const valeur = JSON.stringify(propre);
    await this.prisma.reglagePlateforme.upsert({
      where: { cle: CLE_CONTACT },
      create: { cle: CLE_CONTACT, valeur },
      update: { valeur },
    });
    return propre;
  }

  /** Enregistre la demande si le compte existe ; une demande en attente est mise à jour. */
  async demander(identifiant: string, contact: string | null, message: string | null) {
    const utilisateur = await this.prisma.utilisateur.findFirst({
      where: { identifiant: { equals: identifiant.trim(), mode: 'insensitive' } },
    });
    if (!utilisateur) return REPONSE_DEMANDE;
    const donnees = { contact: contact?.trim() || null, message: message?.trim() || null };
    const enAttente = await this.prisma.demandeMotDePasse.findFirst({
      where: { utilisateurId: utilisateur.id, statut: 'EN_ATTENTE' },
    });
    if (enAttente) {
      await this.prisma.demandeMotDePasse.update({
        where: { id: enAttente.id },
        data: { ...donnees, creeLe: new Date(), ip: ipRequete() ?? null },
      });
    } else {
      await this.prisma.demandeMotDePasse.create({
        data: {
          ...donnees,
          utilisateurId: utilisateur.id,
          commerceId: utilisateur.commerceId,
          ip: ipRequete() ?? null,
        },
      });
      await this.audit.journaliser({
        commerceId: utilisateur.commerceId,
        action: ACTIONS_AUDIT.MOT_DE_PASSE_DEMANDE,
        utilisateurId: utilisateur.id,
      });
    }
    return REPONSE_DEMANDE;
  }

  async nombreEnAttente() {
    return {
      enAttente: await this.prisma.demandeMotDePasse.count({ where: { statut: 'EN_ATTENTE' } }),
    };
  }

  /** Demandes récentes, celles en attente d'abord, avec le compte et le commerce. */
  async demandes() {
    const demandes = await this.prisma.demandeMotDePasse.findMany({
      orderBy: [{ statut: 'asc' }, { creeLe: 'desc' }],
      take: 100,
    });
    const utilisateurs = await this.prisma.utilisateur.findMany({
      where: { id: { in: demandes.map((d) => d.utilisateurId) } },
      select: { id: true, nom: true, identifiant: true, role: true, telephone: true, actif: true },
    });
    const commerces = await this.prisma.commerce.findMany({
      where: { id: { in: demandes.map((d) => d.commerceId) } },
      select: { id: true, nom: true, statut: true },
    });
    const concepteurs = await this.prisma.concepteur.findMany({
      where: { id: { in: demandes.flatMap((d) => (d.traiteParId ? [d.traiteParId] : [])) } },
      select: { id: true, nom: true },
    });
    return demandes.map((d) => {
      const u = utilisateurs.find((x) => x.id === d.utilisateurId);
      const c = commerces.find((x) => x.id === d.commerceId);
      return {
        id: d.id,
        statut: d.statut,
        creeLe: d.creeLe.toISOString(),
        traiteLe: d.traiteLe?.toISOString() ?? null,
        traitePar: concepteurs.find((x) => x.id === d.traiteParId)?.nom ?? null,
        contact: d.contact,
        message: d.message,
        utilisateur: u
          ? { nom: u.nom, identifiant: u.identifiant, role: u.role, telephone: u.telephone }
          : null,
        commerce: c ? { id: c.id, nom: c.nom, statut: c.statut } : null,
      };
    });
  }

  private async enAttente(id: string) {
    const demande = await this.prisma.demandeMotDePasse.findUnique({ where: { id } });
    if (!demande) throw new NotFoundException('Demande introuvable.');
    if (demande.statut !== 'EN_ATTENTE') throw new ConflictException('Demande déjà traitée.');
    return demande;
  }

  /** Nouveau mot de passe provisoire pour le compte de la demande, affiché une fois. */
  async nouveauMotDePasse(concepteur: ConcepteurConnecte, id: string) {
    const demande = await this.enAttente(id);
    const utilisateur = await this.prisma.utilisateur.findUnique({
      where: { id: demande.utilisateurId },
    });
    if (!utilisateur) throw new NotFoundException('Compte introuvable.');
    const motDePasse = motDePasseProvisoire();
    await this.prisma.$transaction([
      this.prisma.utilisateur.update({
        where: { id: utilisateur.id },
        data: { motDePasseHash: await hash(motDePasse), actif: true },
      }),
      this.prisma.demandeMotDePasse.update({
        where: { id },
        data: { statut: 'TRAITEE', traiteLe: new Date(), traiteParId: concepteur.id },
      }),
    ]);
    await this.audit.journaliser({
      commerceId: utilisateur.commerceId,
      action: ACTIONS_AUDIT.PLATEFORME_MOT_DE_PASSE,
      utilisateurId: utilisateur.id,
      details: { concepteur: concepteur.nom, demande: id },
    });
    return {
      nom: utilisateur.nom,
      identifiant: utilisateur.identifiant,
      motDePasse,
      contact: demande.contact ?? utilisateur.telephone,
    };
  }

  async ignorer(concepteur: ConcepteurConnecte, id: string) {
    await this.enAttente(id);
    await this.prisma.demandeMotDePasse.update({
      where: { id },
      data: { statut: 'IGNOREE', traiteLe: new Date(), traiteParId: concepteur.id },
    });
  }
}
