import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  apresRappel,
  type EcheanceRappel,
  formaterMontant,
  jourFr,
  jourLocal,
  type ParametresRappels,
  penaliteDue,
  rappelDu,
  type RappelDu,
  resteEcheance,
} from '@gestvente/commun';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import { BOUTIQUE_OUVERTE } from '../auth/acces.regles.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import type { Commerce, Credit, Echeance } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { MessagesService } from '../messages/messages.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JournalService, type Tx } from '../sync/journal.service.js';
import { changementsCredit, versDateJour } from './credit.ecritures.js';
import { parametresDe } from './parametres.js';

/** Tâche quotidienne : 9 h à Conakry (les jours se comptent au fuseau de chaque commerce). */
export const HORAIRE_RAPPELS = { pattern: '0 9 * * *', tz: 'Africa/Conakry' };

const versRappel = (e: Echeance): EcheanceRappel => ({
  numero: e.numero,
  dateEcheance: e.dateEcheance.toISOString().slice(0, 10),
  montant: Number(e.montant),
  montantPaye: Number(e.montantPaye),
  penalite: Number(e.penalite),
  dernierRappel: e.dernierRappelLe?.toISOString().slice(0, 10) ?? null,
  nombreRelances: e.nombreRelances,
});

type CreditComplet = Credit & {
  echeances: Echeance[];
  client: { nom: string; telephone: string };
  boutique: { nom: string };
};

/**
 * Rappels des tranches (avant l'échéance, le jour même, relances de retard) et
 * pénalités, chaque jour par une tâche BullMQ ; relance manuelle par le gérant.
 * Les messages passent par MessagesService (file, essais, bascule vers le SMS).
 */
@Injectable()
export class RappelsService implements OnModuleInit, OnModuleDestroy {
  private readonly journalLog = new Logger('Rappels');
  private readonly connexion: Redis;
  private readonly file: Queue;
  private travailleur: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messages: MessagesService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {
    this.connexion = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.file = new Queue(`${config.get<string>('REDIS_PREFIXE', 'gestvente')}-rappels`, {
      connection: this.connexion,
    });
  }

  async onModuleInit() {
    this.travailleur = new Worker(this.file.name, () => this.executer().then(() => undefined), {
      connection: this.connexion.duplicate(),
      concurrency: 1,
    });
    this.travailleur.on('error', (e) => this.journalLog.error(e.message));
    await this.file.upsertJobScheduler('rappels-quotidiens', HORAIRE_RAPPELS, {
      name: 'rappels',
      opts: { removeOnComplete: true, removeOnFail: 100 },
    });
  }

  async onModuleDestroy() {
    await this.travailleur?.close();
    await this.file.close();
    await this.connexion.quit().catch(() => undefined);
  }

  /** Passage quotidien sur tous les commerces en service. */
  async executer(
    maintenant = new Date(),
    /** Limiter à certains commerces (tests). */
    seulement?: string[],
  ): Promise<{ rappels: number; penalites: number }> {
    const total = { rappels: 0, penalites: 0 };
    const commerces = await this.prisma.commerce.findMany({
      where: { statut: 'ACTIF', ...(seulement ? { id: { in: seulement } } : {}) },
    });
    for (const commerce of commerces) {
      try {
        const r = await this.traiterCommerce(commerce, maintenant);
        total.rappels += r.rappels;
        total.penalites += r.penalites;
      } catch (e) {
        this.journalLog.error(`Commerce ${commerce.id} : ${(e as Error).message}`);
      }
    }
    if (total.rappels || total.penalites) {
      this.journalLog.log(`${total.rappels} rappel(s), ${total.penalites} pénalité(s).`);
    }
    return total;
  }

  private async traiterCommerce(commerce: Commerce, maintenant: Date) {
    const aujourdhui = jourLocal(maintenant, commerce.fuseau);
    const p = parametresDe(commerce);
    const credits = await this.prisma.credit.findMany({
      where: { commerceId: commerce.id, statut: 'EN_COURS', boutique: BOUTIQUE_OUVERTE },
      include: {
        echeances: true,
        client: { select: { nom: true, telephone: true } },
        boutique: { select: { nom: true } },
      },
    });
    let rappels = 0;
    let penalites = 0;
    for (const credit of credits) {
      const r = await this.prisma.$transaction(async (tx) => {
        await this.journal.verrouiller(tx, commerce.id);
        const ajout = await this.appliquerPenalites(tx, commerce, credit, aujourdhui, p);
        const echeances = await tx.echeance.findMany({ where: { creditId: credit.id } });
        const rappel = rappelDu(echeances.map(versRappel), aujourdhui, p);
        if (rappel)
          await this.envoyerRappel(tx, commerce, credit, echeances, rappel, aujourdhui, p.canal);
        if (ajout || rappel) {
          await this.journal.ecrire(tx, commerce.id, await changementsCredit(tx, credit.id));
        }
        return { ajout, rappel: rappel !== null };
      });
      penalites += r.ajout;
      rappels += r.rappel ? 1 : 0;
    }
    return { rappels, penalites };
  }

  /** Pénalités dues aujourd'hui ajoutées aux tranches et au reste dû ; nombre appliqué. */
  private async appliquerPenalites(
    tx: Tx,
    commerce: Commerce,
    credit: CreditComplet,
    aujourdhui: string,
    p: ParametresRappels,
  ): Promise<number> {
    let nombre = 0;
    for (const e of credit.echeances) {
      const montant = penaliteDue(versRappel(e), aujourdhui, p);
      if (!montant) continue;
      await tx.echeance.update({
        where: { id: e.id },
        data: { penalite: montant, soldeeLe: null },
      });
      await tx.credit.update({
        where: { id: credit.id },
        data: { montantRestant: { increment: montant } },
      });
      await this.audit.journaliser(
        {
          commerceId: commerce.id,
          boutiqueId: credit.boutiqueId,
          action: ACTIONS_AUDIT.PENALITE_APPLIQUEE,
          entite: 'Credit',
          entiteId: credit.id,
          details: {
            tranche: e.numero,
            montant,
            regle: { type: p.penaliteType, valeur: p.penaliteValeur },
          },
        },
        tx,
      );
      nombre++;
    }
    return nombre;
  }

  private async envoyerRappel(
    tx: Tx,
    commerce: Commerce,
    credit: CreditComplet,
    echeances: Echeance[],
    rappel: RappelDu,
    aujourdhui: string,
    canal: 'SMS' | 'WHATSAPP',
  ) {
    const visee = echeances.find((e) => e.numero === rappel.numero)!;
    await this.messages.envoyer(tx, {
      commerceId: commerce.id,
      boutiqueId: credit.boutiqueId,
      clientId: credit.clientId,
      destinataire: credit.client.telephone,
      type: rappel.type === 'RETARD' ? 'RETARD_ECHEANCE' : 'RAPPEL_ECHEANCE',
      canal,
      variables: {
        client: credit.client.nom,
        boutique: credit.boutique.nom,
        montant: formaterMontant(rappel.montant, '').replace(/[  ]/g, ' ').trim(),
        monnaie: commerce.monnaie,
        echeance: jourFr(rappel.dateEcheance),
      },
      referenceType: 'Echeance',
      referenceId: visee.id,
    });
    const apres = apresRappel(echeances.map(versRappel), rappel, aujourdhui);
    for (const e of echeances) {
      const nouvel = apres.find((x) => x.numero === e.numero)!;
      if (nouvel.dernierRappel !== aujourdhui) continue;
      await tx.echeance.update({
        where: { id: e.id },
        data: {
          dernierRappelLe: versDateJour(aujourdhui),
          nombreRappels: { increment: 1 },
          nombreRelances: nouvel.nombreRelances,
        },
      });
    }
  }

  /**
   * « Relancer maintenant » (gérant, propriétaire) : relance du montant échu, sinon
   * rappel de la prochaine tranche. Compte comme le rappel du jour.
   */
  async relancer(utilisateur: UtilisateurConnecte, creditId: string) {
    const credit = await this.prisma.credit.findFirst({
      where: { id: creditId, commerceId: utilisateur.commerceId },
      include: {
        echeances: true,
        client: { select: { nom: true, telephone: true } },
        boutique: { select: { nom: true } },
        commerce: true,
      },
    });
    if (!credit) throw new NotFoundException('Crédit introuvable.');
    if (
      utilisateur.role !== Role.PROPRIETAIRE &&
      !utilisateur.boutiqueIds.includes(credit.boutiqueId)
    ) {
      throw new ForbiddenException('Crédit d’une autre boutique.');
    }
    if (credit.statut !== 'EN_COURS')
      throw new ForbiddenException('Ce crédit n’est plus en cours.');
    const aujourdhui = jourLocal(new Date(), credit.commerce.fuseau);
    const ouvertes = credit.echeances
      .map(versRappel)
      .filter((e) => resteEcheance(e) > 0)
      .sort((a, b) => a.numero - b.numero);
    const echues = ouvertes.filter((e) => e.dateEcheance < aujourdhui);
    const premiere = echues[0] ?? ouvertes[0];
    const rappel: RappelDu = {
      type: echues.length ? 'RETARD' : premiere.dateEcheance === aujourdhui ? 'JOUR' : 'AVANT',
      numero: premiere.numero,
      dateEcheance: premiere.dateEcheance,
      montant: echues.length
        ? echues.reduce((t, e) => t + resteEcheance(e), 0)
        : resteEcheance(premiere),
    };
    await this.prisma.$transaction(async (tx) => {
      await this.journal.verrouiller(tx, utilisateur.commerceId);
      await this.envoyerRappel(
        tx,
        credit.commerce,
        credit,
        credit.echeances,
        rappel,
        aujourdhui,
        credit.commerce.canalRappels,
      );
      await this.journal.ecrire(tx, utilisateur.commerceId, await changementsCredit(tx, credit.id));
      await this.audit.journaliser(
        {
          commerceId: utilisateur.commerceId,
          boutiqueId: credit.boutiqueId,
          action: ACTIONS_AUDIT.RELANCE_MANUELLE,
          utilisateurId: utilisateur.id,
          appareilId: utilisateur.appareilId,
          entite: 'Credit',
          entiteId: credit.id,
          details: { type: rappel.type, montant: rappel.montant },
        },
        tx,
      );
    });
    return { type: rappel.type, montant: rappel.montant, canal: credit.commerce.canalRappels };
  }

  async parametres(commerceId: string): Promise<ParametresRappels> {
    return parametresDe(
      await this.prisma.commerce.findUniqueOrThrow({ where: { id: commerceId } }),
    );
  }

  async modifierParametres(utilisateur: UtilisateurConnecte, p: ParametresRappels) {
    const avant = await this.parametres(utilisateur.commerceId);
    await this.prisma.commerce.update({
      where: { id: utilisateur.commerceId },
      data: {
        rappelJoursAvant: p.joursAvant,
        relancesMax: p.relancesMax,
        canalRappels: p.canal,
        penaliteActive: p.penaliteActive,
        penaliteType: p.penaliteType,
        penaliteValeur: p.penaliteValeur,
        penaliteGrace: p.penaliteGrace,
      },
    });
    await this.audit.journaliser({
      commerceId: utilisateur.commerceId,
      action: ACTIONS_AUDIT.PARAMETRES_RAPPELS,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      details: { avant, apres: p } as never,
    });
    return p;
  }
}
