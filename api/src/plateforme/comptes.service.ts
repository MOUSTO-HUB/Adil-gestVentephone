import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ConcepteurConnecte } from './concepteur.guard.js';
import {
  adresseOtpauth,
  chiffrerSecret,
  dechiffrerSecret,
  nouveauSecret,
  verifierTotp,
} from './totp.js';

/** Nom affiché dans l'application d'authentification. */
const EMETTEUR = 'Gestion vente Phone';
/** Mot de passe choisi par le concepteur : assez long pour un compte qui voit tous les commerces. */
export const LONGUEUR_MIN_MOT_DE_PASSE = 10;

const motDePasseProvisoire = () => randomBytes(12).toString('base64url');

/** Règle du mot de passe choisi : rend le motif du refus, ou null. */
export function refusMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE)
    return `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`;
  if (!/[A-Za-z]/.test(motDePasse) || !/\d/.test(motDePasse))
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  return null;
}

/** Identifiant d'un compte supprimé : libère l'identifiant d'origine pour un nouveau compte. */
const identifiantSupprime = (identifiant: string, id: string) =>
  `${identifiant}~supprime-${id.slice(0, 8)}`;

/**
 * Comptes des concepteurs : liste, création, désactivation, suppression (le compte seul :
 * les commerces et le reste de ce qu'il a créé sont gardés), mot de passe et double
 * authentification par application (Google Authenticator…). Un concepteur peut en aider
 * un autre : nouveau mot de passe provisoire, et retrait de sa double authentification
 * s'il a perdu son téléphone.
 */
@Injectable()
export class ComptesConcepteurService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get cleMaitre(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  /** Vérifie un code de l'application ; mémorise le pas utilisé (un code ne sert qu'une fois). */
  async verifierCode(concepteurId: string, code: string | undefined): Promise<boolean> {
    const c = await this.prisma.concepteur.findUnique({ where: { id: concepteurId } });
    if (!c?.totpSecret || !code) return false;
    let secret: string;
    try {
      secret = dechiffrerSecret(c.totpSecret, this.cleMaitre);
    } catch {
      return false;
    }
    const pas = verifierTotp(secret, code, c.totpDernierPas);
    if (pas === null) return false;
    await this.prisma.concepteur.update({ where: { id: c.id }, data: { totpDernierPas: pas } });
    return true;
  }

  async liste(moi: ConcepteurConnecte) {
    const comptes = await this.prisma.concepteur.findMany({
      where: { supprimeLe: null },
      orderBy: { creeLe: 'asc' },
    });
    return comptes.map((c) => ({
      id: c.id,
      nom: c.nom,
      identifiant: c.identifiant,
      actif: c.actif,
      doubleAuth: c.totpActif,
      doitChangerMotDePasse: c.doitChangerMotDePasse,
      derniereConnexion: c.derniereConnexion,
      creeLe: c.creeLe,
      moi: c.id === moi.id,
    }));
  }

  async creer(moi: ConcepteurConnecte, nom: string, identifiantSaisi: string) {
    const identifiant = identifiantSaisi.trim().toLowerCase();
    if (await this.prisma.concepteur.findUnique({ where: { identifiant } }))
      throw new ConflictException(`L’identifiant « ${identifiant} » est déjà utilisé.`);
    const motDePasse = motDePasseProvisoire();
    const compte = await this.prisma.concepteur.create({
      data: {
        nom: nom.trim(),
        identifiant,
        motDePasseHash: await hash(motDePasse),
        doitChangerMotDePasse: true,
        creeParId: moi.id,
      },
    });
    return { id: compte.id, identifiant, motDePasseProvisoire: motDePasse };
  }

  /** Compte d'un autre concepteur (jamais le sien : il passe par « Mon compte »). */
  private async autre(moi: ConcepteurConnecte, id: string) {
    if (id === moi.id)
      throw new BadRequestException('Pour votre propre compte, utilisez « Mon compte ».');
    const c = await this.prisma.concepteur.findUnique({ where: { id } });
    if (!c || c.supprimeLe) throw new NotFoundException('Compte de concepteur introuvable.');
    return c;
  }

  /** Il doit toujours rester au moins un autre concepteur actif. */
  private async garderUnActif(sauf: string) {
    const actifs = await this.prisma.concepteur.count({
      where: { actif: true, supprimeLe: null, id: { not: sauf } },
    });
    if (actifs === 0)
      throw new BadRequestException('Impossible : il doit rester au moins un concepteur actif.');
  }

  async changerActivation(moi: ConcepteurConnecte, id: string, actif: boolean) {
    await this.autre(moi, id);
    if (!actif) await this.garderUnActif(id);
    await this.prisma.concepteur.update({ where: { id }, data: { actif } });
  }

  /** Aide à un autre concepteur : mot de passe provisoire, et double authentification retirée si demandé. */
  async recuperation(moi: ConcepteurConnecte, id: string, retirerDoubleAuth: boolean) {
    const c = await this.autre(moi, id);
    const motDePasse = motDePasseProvisoire();
    await this.prisma.concepteur.update({
      where: { id },
      data: {
        motDePasseHash: await hash(motDePasse),
        doitChangerMotDePasse: true,
        ...(retirerDoubleAuth ? { totpActif: false, totpSecret: null, totpDernierPas: null } : {}),
      },
    });
    return { identifiant: c.identifiant, motDePasseProvisoire: motDePasse };
  }

  /** Suppression du compte seul : il ne se connecte plus, ses traces et ses créations restent. */
  async supprimer(moi: ConcepteurConnecte, id: string) {
    const c = await this.autre(moi, id);
    await this.garderUnActif(id);
    await this.prisma.concepteur.update({
      where: { id },
      data: {
        supprimeLe: new Date(),
        actif: false,
        identifiant: identifiantSupprime(c.identifiant, c.id),
        totpActif: false,
        totpSecret: null,
      },
    });
  }

  async monCompte(moi: ConcepteurConnecte) {
    const c = await this.prisma.concepteur.findUniqueOrThrow({ where: { id: moi.id } });
    return {
      nom: c.nom,
      identifiant: c.identifiant,
      doubleAuth: c.totpActif,
      doitChangerMotDePasse: c.doitChangerMotDePasse,
    };
  }

  async changerMotDePasse(moi: ConcepteurConnecte, actuel: string, nouveau: string) {
    const c = await this.prisma.concepteur.findUniqueOrThrow({ where: { id: moi.id } });
    if (!(await verify(c.motDePasseHash, actuel)))
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    const refus = refusMotDePasse(nouveau);
    if (refus) throw new BadRequestException(refus);
    if (nouveau === actuel)
      throw new BadRequestException('Choisissez un mot de passe différent de l’actuel.');
    await this.prisma.concepteur.update({
      where: { id: moi.id },
      data: { motDePasseHash: await hash(nouveau), doitChangerMotDePasse: false },
    });
  }

  /** Étape 1 : nouveau secret (pas encore actif) et QR code à scanner. */
  async preparerDoubleAuth(moi: ConcepteurConnecte) {
    const c = await this.prisma.concepteur.findUniqueOrThrow({ where: { id: moi.id } });
    if (c.totpActif)
      throw new BadRequestException('La double authentification est déjà active sur ce compte.');
    const secret = nouveauSecret();
    await this.prisma.concepteur.update({
      where: { id: moi.id },
      data: { totpSecret: chiffrerSecret(secret, this.cleMaitre), totpDernierPas: null },
    });
    const adresse = adresseOtpauth(secret, c.identifiant, EMETTEUR);
    return {
      secret: secret.replace(/(.{4})/g, '$1 ').trim(),
      adresse,
      qrCode: await QRCode.toDataURL(adresse, { margin: 1, width: 240 }),
    };
  }

  /** Étape 2 : le premier code de l'application confirme le réglage. */
  async activerDoubleAuth(moi: ConcepteurConnecte, code: string) {
    const c = await this.prisma.concepteur.findUniqueOrThrow({ where: { id: moi.id } });
    if (c.totpActif) return;
    if (!c.totpSecret) throw new BadRequestException('Commencez par afficher le QR code.');
    if (!(await this.verifierCode(moi.id, code)))
      throw new BadRequestException('Code incorrect. Saisissez le code affiché par l’application.');
    await this.prisma.concepteur.update({ where: { id: moi.id }, data: { totpActif: true } });
  }

  async desactiverDoubleAuth(moi: ConcepteurConnecte, code: string) {
    const c = await this.prisma.concepteur.findUniqueOrThrow({ where: { id: moi.id } });
    if (!c.totpActif) return;
    if (!(await this.verifierCode(moi.id, code)))
      throw new ForbiddenException('Code incorrect : la double authentification reste active.');
    await this.prisma.concepteur.update({
      where: { id: moi.id },
      data: { totpActif: false, totpSecret: null, totpDernierPas: null },
    });
  }
}
