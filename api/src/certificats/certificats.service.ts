import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACTIONS_AUDIT, type ActionAudit, AuditService } from '../audit/audit.service.js';
import type { CertificatAppareil } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  type ClePublique,
  clePublique,
  empreinteCle,
  empreinteCode,
  genererCode,
  signatureValide,
  VALIDITE_CODE_MS,
  VALIDITE_DEFI,
} from './certificats.regles.js';

/** Compte dont on certifie les appareils : employé d'un commerce ou concepteur. */
export type Titulaire =
  { type: 'UTILISATEUR'; id: string; commerceId: string } | { type: 'CONCEPTEUR'; id: string };

/** Preuve envoyée à la connexion : clé publique de l'appareil et défi signé. */
export interface PreuveAppareil {
  cle: unknown;
  defi: string;
  signature: string;
}

export interface InfosAppareil {
  nom: string;
  plateforme: string;
}

/** Codes d'erreur lus par l'application pour afficher la bonne aide. */
export const CODES_REFUS = {
  preuveAbsente: 'APPAREIL_PREUVE_ABSENTE',
  nonAutorise: 'APPAREIL_NON_AUTORISE',
  codeInvalide: 'CODE_APPAREIL_INVALIDE',
} as const;

const refus = (code: string, message: string) =>
  new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });

const champTitulaire = (t: Titulaire) =>
  t.type === 'UTILISATEUR' ? { utilisateurId: t.id } : { concepteurId: t.id };

const aQui = (t: Titulaire) =>
  t.type === 'UTILISATEUR'
    ? 'au propriétaire de votre commerce (Menu › Appareils autorisés) ou au service GestVente'
    : 'à un autre concepteur (Comptes › Appareils autorisés)';

/**
 * Certification des appareils : un appareil n'ouvre une session que s'il est autorisé
 * pour le compte (clé publique enregistrée) et prouve qu'il détient la clé privée.
 * Premier appareil d'un compte : autorisé d'office ; les suivants avec un code donné
 * par un administrateur (concepteur, propriétaire ou gérant).
 */
@Injectable()
export class CertificatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Défi à signer par l'appareil (valable 3 minutes). */
  async defi(): Promise<{ defi: string }> {
    return {
      defi: await this.jwt.signAsync(
        { type: 'defi', n: randomUUID() },
        { expiresIn: VALIDITE_DEFI },
      ),
    };
  }

  /** Vérifie le défi et sa signature ; rend la clé et son empreinte. */
  private async verifierPreuve(preuve: PreuveAppareil | undefined) {
    if (!preuve) {
      throw refus(
        CODES_REFUS.preuveAbsente,
        'Mettez à jour l’application (bandeau « Nouvelle version » ou actualisez la page), puis reconnectez-vous.',
      );
    }
    const invalide = refus(
      CODES_REFUS.preuveAbsente,
      'Vérification de l’appareil impossible. Actualisez la page puis reconnectez-vous.',
    );
    try {
      const charge = await this.jwt.verifyAsync<{ type?: string }>(preuve.defi);
      if (charge.type !== 'defi') throw invalide;
    } catch {
      throw invalide;
    }
    const cle = clePublique(preuve.cle);
    if (!cle || !signatureValide(cle, preuve.defi, preuve.signature)) throw invalide;
    return { cle, empreinte: empreinteCle(cle) };
  }

  /**
   * Contrôle de l'appareil à la connexion (après le mot de passe). Rend le certificat de
   * l'appareil, ou refuse (403, avec un code lu par l'application).
   */
  async controlerConnexion(
    titulaire: Titulaire,
    preuve: PreuveAppareil | undefined,
    codeSaisi: string | undefined,
    appareil: InfosAppareil,
  ): Promise<CertificatAppareil> {
    const { cle, empreinte } = await this.verifierPreuve(preuve);
    const existant = await this.prisma.certificatAppareil.findFirst({
      where: { empreinte, ...champTitulaire(titulaire) },
    });
    if (existant && !existant.revoqueLe) {
      return this.prisma.certificatAppareil.update({
        where: { id: existant.id },
        data: { dernierUsage: new Date() },
      });
    }
    if (codeSaisi?.trim()) return this.utiliserCode(titulaire, codeSaisi, cle, empreinte, appareil);

    const dejaCertifies = await this.prisma.certificatAppareil.count({
      where: champTitulaire(titulaire),
    });
    if (dejaCertifies === 0) {
      return this.enregistrer(titulaire, cle, empreinte, appareil, 'PREMIER_APPAREIL', null);
    }
    await this.journaliser(titulaire, ACTIONS_AUDIT.APPAREIL_REFUSE, {
      appareil: appareil.nom,
      plateforme: appareil.plateforme,
    });
    throw refus(
      CODES_REFUS.nonAutorise,
      `Cet appareil n’est pas encore autorisé pour votre compte. Demandez un code d’autorisation ${aQui(titulaire)}, puis saisissez-le.`,
    );
  }

  /** Code d'autorisation : à usage unique, du bon compte, pas expiré. */
  private async utiliserCode(
    titulaire: Titulaire,
    codeSaisi: string,
    cle: ClePublique,
    empreinte: string,
    appareil: InfosAppareil,
  ): Promise<CertificatAppareil> {
    const code = await this.prisma.codeAppareil.findUnique({
      where: { codeHash: empreinteCode(codeSaisi) },
    });
    const valable =
      code &&
      !code.utiliseLe &&
      !code.annuleLe &&
      code.expireLe > new Date() &&
      (titulaire.type === 'UTILISATEUR'
        ? code.utilisateurId === titulaire.id
        : code.concepteurId === titulaire.id);
    if (!valable) {
      throw refus(
        CODES_REFUS.codeInvalide,
        'Code d’autorisation incorrect ou expiré (valable 24 heures, une seule fois). Demandez-en un nouveau.',
      );
    }
    await this.prisma.codeAppareil.update({
      where: { id: code.id },
      data: { utiliseLe: new Date() },
    });
    const certificat = await this.enregistrer(
      titulaire,
      cle,
      empreinte,
      appareil,
      'CODE',
      code.creePar,
    );
    if (code.remplacer) {
      const anciens = await this.prisma.certificatAppareil.findMany({
        where: { ...champTitulaire(titulaire), revoqueLe: null, id: { not: certificat.id } },
        select: { id: true },
      });
      for (const a of anciens) await this.revoquer(a.id, `${code.creePar} (remplacé)`);
    }
    return certificat;
  }

  /** Crée le certificat, ou réactive celui d'un appareil révoqué puis autorisé à nouveau. */
  private async enregistrer(
    titulaire: Titulaire,
    cle: ClePublique,
    empreinte: string,
    appareil: InfosAppareil,
    origine: 'PREMIER_APPAREIL' | 'SESSION_EXISTANTE' | 'CODE',
    autorisePar: string | null,
  ): Promise<CertificatAppareil> {
    const donnees = {
      nom: appareil.nom,
      plateforme: appareil.plateforme,
      origine,
      clePublique: { ...cle },
      revoqueLe: null,
      revoquePar: null,
      dernierUsage: new Date(),
    };
    const existant = await this.prisma.certificatAppareil.findFirst({
      where: { empreinte, ...champTitulaire(titulaire) },
    });
    const certificat = existant
      ? await this.prisma.certificatAppareil.update({ where: { id: existant.id }, data: donnees })
      : await this.prisma.certificatAppareil.create({
          data: {
            ...donnees,
            titulaire: titulaire.type,
            empreinte,
            ...champTitulaire(titulaire),
            commerceId: titulaire.type === 'UTILISATEUR' ? titulaire.commerceId : null,
          },
        });
    await this.journaliser(titulaire, ACTIONS_AUDIT.APPAREIL_AUTORISE, {
      appareil: appareil.nom,
      plateforme: appareil.plateforme,
      origine,
      ...(autorisePar ? { autorisePar } : {}),
    });
    return certificat;
  }

  /**
   * Session ouverte avant la certification : l'appareil déjà connecté est enregistré
   * (s'il n'a pas été révoqué), sinon la session est fermée.
   */
  async certifierSession(
    titulaire: Extract<Titulaire, { type: 'UTILISATEUR' }>,
    appareilId: string,
    preuve: PreuveAppareil,
  ): Promise<{ certifie: true }> {
    const { cle, empreinte } = await this.verifierPreuve(preuve);
    const session = await this.prisma.appareil.findUniqueOrThrow({ where: { id: appareilId } });
    const existant = await this.prisma.certificatAppareil.findFirst({
      where: { empreinte, utilisateurId: titulaire.id },
    });
    if (existant?.revoqueLe) {
      await this.prisma.appareil.update({
        where: { id: appareilId },
        data: { revoqueLe: new Date(), jetonHash: null },
      });
      throw refus(CODES_REFUS.nonAutorise, 'Cet appareil a été retiré de votre compte.');
    }
    if (session.certificatId && session.certificatId !== existant?.id) {
      throw refus(CODES_REFUS.nonAutorise, 'Cet appareil ne correspond pas à votre session.');
    }
    const certificat =
      existant ??
      (await this.enregistrer(
        titulaire,
        cle,
        empreinte,
        { nom: session.nom, plateforme: session.plateforme },
        'SESSION_EXISTANTE',
        null,
      ));
    if (!session.certificatId) {
      await this.prisma.appareil.update({
        where: { id: appareilId },
        data: { certificatId: certificat.id },
      });
    }
    return { certifie: true };
  }

  /** Nouveau code d'autorisation (les codes encore valables du compte sont annulés). */
  async creerCode(titulaire: Titulaire, creePar: string, remplacer: boolean) {
    const maintenant = new Date();
    await this.prisma.codeAppareil.updateMany({
      where: { ...champTitulaire(titulaire), utiliseLe: null, annuleLe: null },
      data: { annuleLe: maintenant },
    });
    const code = genererCode();
    const expireLe = new Date(maintenant.getTime() + VALIDITE_CODE_MS);
    await this.prisma.codeAppareil.create({
      data: {
        titulaire: titulaire.type,
        ...champTitulaire(titulaire),
        commerceId: titulaire.type === 'UTILISATEUR' ? titulaire.commerceId : null,
        codeHash: empreinteCode(code),
        remplacer,
        expireLe,
        creePar,
      },
    });
    await this.journaliser(titulaire, ACTIONS_AUDIT.CODE_APPAREIL_CREE, { creePar, remplacer });
    return { code, expireLe: expireLe.toISOString(), remplacer };
  }

  /** Révoque un appareil : ses sessions sont fermées aussitôt. */
  async revoquer(certificatId: string, par: string): Promise<CertificatAppareil> {
    const certificat = await this.prisma.certificatAppareil.findUnique({
      where: { id: certificatId },
    });
    if (!certificat) throw new NotFoundException('Appareil introuvable.');
    if (certificat.revoqueLe) return certificat;
    const revoque = await this.prisma.certificatAppareil.update({
      where: { id: certificatId },
      data: { revoqueLe: new Date(), revoquePar: par },
    });
    await this.prisma.appareil.updateMany({
      where: { certificatId, revoqueLe: null },
      data: { revoqueLe: new Date(), jetonHash: null },
    });
    if (certificat.utilisateurId && certificat.commerceId) {
      await this.journaliser(
        { type: 'UTILISATEUR', id: certificat.utilisateurId, commerceId: certificat.commerceId },
        ACTIONS_AUDIT.APPAREIL_REVOQUE,
        { appareil: certificat.nom, par },
      );
    }
    return revoque;
  }

  /** Session du concepteur : son appareil est-il toujours autorisé ? */
  async actif(certificatId: string | undefined, concepteurId: string): Promise<boolean> {
    if (!certificatId) return false;
    const c = await this.prisma.certificatAppareil.findUnique({ where: { id: certificatId } });
    return !!c && !c.revoqueLe && c.concepteurId === concepteurId;
  }

  /** Appareils autorisés et codes en attente des comptes donnés. */
  async lister(filtre: { utilisateurIds?: string[]; concepteurIds?: string[] }) {
    const ou = [
      ...(filtre.utilisateurIds ? [{ utilisateurId: { in: filtre.utilisateurIds } }] : []),
      ...(filtre.concepteurIds ? [{ concepteurId: { in: filtre.concepteurIds } }] : []),
    ];
    if (!ou.length) return { appareils: [], codes: [] };
    const [appareils, codes] = await Promise.all([
      this.prisma.certificatAppareil.findMany({
        where: { OR: ou },
        orderBy: [{ revoqueLe: { sort: 'desc', nulls: 'first' } }, { dernierUsage: 'desc' }],
      }),
      this.prisma.codeAppareil.findMany({
        where: { OR: ou, utiliseLe: null, annuleLe: null, expireLe: { gt: new Date() } },
      }),
    ]);
    return {
      appareils: appareils.map((a) => ({
        id: a.id,
        titulaireId: a.utilisateurId ?? a.concepteurId,
        nom: a.nom,
        plateforme: a.plateforme,
        origine: a.origine,
        empreinte: a.empreinte.slice(0, 8),
        creeLe: a.creeLe.toISOString(),
        dernierUsage: a.dernierUsage?.toISOString() ?? null,
        revoqueLe: a.revoqueLe?.toISOString() ?? null,
        revoquePar: a.revoquePar,
      })),
      codes: codes.map((c) => ({
        titulaireId: c.utilisateurId ?? c.concepteurId,
        expireLe: c.expireLe.toISOString(),
        creePar: c.creePar,
        remplacer: c.remplacer,
      })),
    };
  }

  /** Certificat d'un appareil (pour vérifier à qui il appartient avant de le révoquer). */
  certificat(id: string) {
    return this.prisma.certificatAppareil.findUnique({ where: { id } });
  }

  private async journaliser(titulaire: Titulaire, action: ActionAudit, details: object) {
    if (titulaire.type !== 'UTILISATEUR') return;
    await this.audit.journaliser({
      commerceId: titulaire.commerceId,
      action,
      utilisateurId: titulaire.id,
      details,
    });
  }
}
