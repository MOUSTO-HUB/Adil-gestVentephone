import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CanalMessage,
  CANAUX_MESSAGE,
  MODELES_PAR_DEFAUT,
  PARAMETRES_WHATSAPP,
  remplir,
  texteSms,
  type TypeMessage,
  TYPES_MESSAGE,
  type Variables,
} from '@gestvente/commun';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tx } from '../sync/journal.service.js';
import {
  type SmsSender,
  SMS_SENDER,
  type WhatsAppSender,
  WHATSAPP_SENDER,
} from './fournisseurs.js';

/** Essais par message, avec un délai croissant (5 s, 10 s… ; MESSAGES_DELAI_MS). */
export const ESSAIS_MESSAGE = 3;

export interface DemandeEnvoi {
  commerceId: string;
  boutiqueId?: string | null;
  clientId?: string | null;
  /** Numéro E.164. */
  destinataire: string;
  type: TypeMessage;
  variables: Variables;
  /** Canal souhaité ; WhatsApp sans compte configuré part en SMS. */
  canal: CanalMessage;
  referenceType?: string;
  referenceId?: string;
}

/**
 * Messages aux clients : chaque envoi est inscrit (statut, essais, coût) puis confié à
 * la file BullMQ. Les modules métier appellent `envoyer` dans leur transaction ;
 * jamais un fournisseur directement.
 */
@Injectable()
export class MessagesService implements OnModuleInit, OnModuleDestroy {
  private readonly journal = new Logger('Messages');
  private readonly connexion: Redis;
  private readonly file: Queue;
  private travailleur: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(WHATSAPP_SENDER) private readonly whatsapp: WhatsAppSender,
  ) {
    this.connexion = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.file = new Queue(`${config.get<string>('REDIS_PREFIXE', 'gestvente')}-messages`, {
      connection: this.connexion,
    });
  }

  onModuleInit() {
    this.travailleur = new Worker(this.file.name, (job: Job<{ id: string }>) => this.traiter(job), {
      connection: this.connexion.duplicate(),
      concurrency: 5,
    });
    this.travailleur.on('error', (e) => this.journal.error(e.message));
    // Messages restés en attente (file perdue, redémarrage) : renvoyés dans la file.
    void this.reprendre().catch((e: unknown) => this.journal.error((e as Error).message));
  }

  async onModuleDestroy() {
    await this.travailleur?.close();
    await this.file.close();
    await this.connexion.quit().catch(() => undefined);
  }

  /** Texte du modèle : celui du propriétaire, sinon le texte par défaut. */
  async texteModele(
    tx: Tx | PrismaService,
    commerceId: string,
    type: TypeMessage,
    canal: CanalMessage,
  ): Promise<string> {
    // Le texte WhatsApp est celui du modèle approuvé par Meta : il ne se modifie pas ici.
    if (canal === 'WHATSAPP') return MODELES_PAR_DEFAUT[type].WHATSAPP;
    const modele = await tx.modeleMessage.findUnique({
      where: { commerceId_type_canal: { commerceId, type, canal } },
    });
    return modele?.texte ?? MODELES_PAR_DEFAUT[type][canal];
  }

  private async contenu(
    tx: Tx | PrismaService,
    commerceId: string,
    type: TypeMessage,
    canal: CanalMessage,
    variables: Variables,
  ) {
    const modele = await this.texteModele(tx, commerceId, type, canal);
    return canal === 'SMS' ? texteSms(modele, variables) : remplir(modele, variables);
  }

  /**
   * Inscrit un message et le confie à la file. Dans une transaction, l'envoi part
   * une fois celle-ci validée (le premier essai attend le message en base).
   */
  async envoyer(tx: Tx | PrismaService, d: DemandeEnvoi): Promise<string> {
    const canal: CanalMessage =
      d.canal === 'WHATSAPP' && !this.whatsapp.disponible ? 'SMS' : d.canal;
    const message = await tx.message.create({
      data: {
        commerceId: d.commerceId,
        boutiqueId: d.boutiqueId ?? null,
        clientId: d.clientId ?? null,
        canal,
        type: d.type,
        destinataire: d.destinataire,
        contenu: await this.contenu(tx, d.commerceId, d.type, canal, d.variables),
        variables: d.variables,
        referenceType: d.referenceType ?? null,
        referenceId: d.referenceId ?? null,
      },
    });
    await this.planifier(message.id);
    return message.id;
  }

  private planifier(id: string, delai = 1_000) {
    return this.file.add(
      'envoi',
      { id },
      {
        jobId: id,
        delay: delai,
        attempts: ESSAIS_MESSAGE,
        backoff: {
          type: 'exponential',
          delay: Number(this.config.get('MESSAGES_DELAI_MS', 5_000)),
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  private async reprendre() {
    const enAttente = await this.prisma.message.findMany({
      where: { statut: 'EN_ATTENTE', creeLe: { lt: new Date(Date.now() - 60_000) } },
      select: { id: true },
      take: 500,
    });
    for (const m of enAttente) await this.planifier(m.id);
  }

  /** Un essai d'envoi ; au dernier échec, WhatsApp bascule vers le SMS. */
  async traiter(job: Job<{ id: string }>): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: job.data.id } });
    // Transaction pas encore validée : nouvel essai un peu plus tard.
    if (!message) throw new Error(`Message ${job.data.id} pas encore enregistré.`);
    if (message.statut !== 'EN_ATTENTE') return;
    const variables = (message.variables ?? {}) as Variables;
    try {
      const resultat =
        message.canal === 'WHATSAPP'
          ? await this.whatsapp.envoyerModele(
              message.destinataire,
              message.type,
              PARAMETRES_WHATSAPP[message.type].map((v) => variables[v] ?? ''),
            )
          : await this.sms.envoyer(message.destinataire, message.contenu);
      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          statut: 'ENVOYE',
          envoyeLe: new Date(),
          essais: { increment: 1 },
          cout: resultat.cout,
          referenceFournisseur: resultat.reference,
          erreur: null,
        },
      });
    } catch (e) {
      const erreur = (e as Error).message.slice(0, 500);
      const dernier = job.attemptsMade + 1 >= (job.opts.attempts ?? ESSAIS_MESSAGE);
      await this.prisma.message.update({
        where: { id: message.id },
        data: { essais: { increment: 1 }, erreur, ...(dernier ? { statut: 'ECHEC' } : {}) },
      });
      if (dernier && message.canal === 'WHATSAPP') {
        this.journal.warn(`WhatsApp en échec pour ${message.id} : bascule vers le SMS.`);
        await this.envoyer(this.prisma, {
          commerceId: message.commerceId,
          boutiqueId: message.boutiqueId,
          clientId: message.clientId,
          destinataire: message.destinataire,
          type: message.type,
          variables,
          canal: 'SMS',
          referenceType: message.referenceType ?? undefined,
          referenceId: message.referenceId ?? undefined,
        });
      }
      throw e;
    }
  }

  /** Nouvel envoi d'un message en échec (même canal). */
  async relancer(commerceId: string, id: string) {
    const message = await this.prisma.message.findFirst({ where: { id, commerceId } });
    if (!message) throw new NotFoundException('Message introuvable.');
    if (message.statut !== 'ECHEC') return message;
    const repris = await this.prisma.message.update({
      where: { id },
      data: { statut: 'EN_ATTENTE', essais: 0, erreur: null },
    });
    await this.file.remove(id).catch(() => undefined);
    await this.planifier(id, 0);
    return repris;
  }

  /** Textes de chaque type et canal (modifié par le propriétaire ou par défaut). */
  async modeles(commerceId: string) {
    const personnalises = await this.prisma.modeleMessage.findMany({ where: { commerceId } });
    return TYPES_MESSAGE.flatMap((type) =>
      CANAUX_MESSAGE.map((canal) => {
        const perso =
          canal === 'SMS'
            ? personnalises.find((m) => m.type === type && m.canal === canal)
            : undefined;
        return {
          type,
          canal,
          texte: perso?.texte ?? MODELES_PAR_DEFAUT[type][canal],
          parDefaut: MODELES_PAR_DEFAUT[type][canal],
          personnalise: !!perso,
          modifiable: canal === 'SMS',
        };
      }),
    );
  }

  /** Adresse publique du site (liens des factures envoyés aux clients). */
  get urlPublique(): string {
    return this.config.get<string>('URL_PUBLIQUE', 'http://localhost:3200');
  }

  get whatsappDisponible() {
    return this.whatsapp.disponible;
  }
}
