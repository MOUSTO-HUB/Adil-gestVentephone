import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decalerJour, jourLocal } from '@gestvente/commun';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockageService } from '../stockage/stockage.service.js';
import { TableauService } from './tableau.service.js';

/** Chaque jour à 7 h (Conakry) : les rapports de la dernière semaine et du dernier mois complets. */
export const HORAIRE_RAPPORTS = { pattern: '0 7 * * *', tz: 'Africa/Conakry' };

/** Minuit du jour donné au fuseau du commerce, en date UTC. */
export function minuitLocal(jour: string, fuseau: string): Date {
  const approx = new Date(`${jour}T00:00:00Z`);
  const vu = (tz: string) => new Date(approx.toLocaleString('en-US', { timeZone: tz })).getTime();
  return new Date(approx.getTime() - (vu(fuseau) - vu('UTC')));
}

/** Dernière semaine (lundi → lundi) et dernier mois complets avant `aujourdhui` (AAAA-MM-JJ). */
export function periodesCompletes(aujourdhui: string) {
  const jourSemaine = new Date(`${aujourdhui}T00:00:00Z`).getUTCDay() || 7;
  const debutSemaine = new Date(
    Date.parse(`${aujourdhui}T00:00:00Z`) - (jourSemaine - 1) * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const premierDuMois = `${aujourdhui.slice(0, 8)}01`;
  return {
    semaine: { du: decalerJour(debutSemaine, 'HEBDOMADAIRE', -1), au: debutSemaine },
    mois: { du: decalerJour(premierDuMois, 'MENSUELLE', -1), au: premierDuMois },
  };
}

/**
 * Exports planifiés : classeurs consolidés de chaque commerce (semaine, mois),
 * produits par une tâche BullMQ et gardés dans STOCKAGE_DIR/rapports.
 */
@Injectable()
export class RapportsPlanifiesService implements OnModuleInit, OnModuleDestroy {
  private readonly journal = new Logger('RapportsPlanifies');
  private readonly connexion: Redis;
  private readonly file: Queue;
  private travailleur: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tableau: TableauService,
    private readonly stockage: StockageService,
    config: ConfigService,
  ) {
    this.connexion = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
    this.file = new Queue(`${config.get<string>('REDIS_PREFIXE', 'gestvente')}-rapports`, {
      connection: this.connexion,
    });
  }

  async onModuleInit() {
    this.travailleur = new Worker(this.file.name, () => this.executer().then(() => undefined), {
      connection: this.connexion.duplicate(),
      concurrency: 1,
    });
    this.travailleur.on('error', (e) => this.journal.error(e.message));
    await this.file.upsertJobScheduler('rapports-consolides', HORAIRE_RAPPORTS, {
      name: 'rapports',
      opts: { removeOnComplete: true, removeOnFail: 100 },
    });
  }

  async onModuleDestroy() {
    await this.travailleur?.close();
    await this.file.close();
    await this.connexion.quit().catch(() => undefined);
  }

  /** Crée les rapports manquants (une seule fois par commerce, fréquence et période). */
  async executer(maintenant = new Date(), seulement?: string[]): Promise<number> {
    const commerces = await this.prisma.commerce.findMany({
      where: { statut: 'ACTIF', ...(seulement ? { id: { in: seulement } } : {}) },
      select: { id: true, fuseau: true },
    });
    let crees = 0;
    for (const c of commerces) {
      const periodes = periodesCompletes(jourLocal(maintenant, c.fuseau));
      for (const [frequence, p] of [
        ['SEMAINE', periodes.semaine],
        ['MOIS', periodes.mois],
      ] as const) {
        const du = minuitLocal(p.du, c.fuseau);
        const existe = await this.prisma.rapportArchive.findUnique({
          where: { commerceId_frequence_du: { commerceId: c.id, frequence, du } },
        });
        if (existe) continue;
        try {
          const proprietaire = await this.tableau.proprietaireVirtuel(c.id);
          const au = minuitLocal(p.au, c.fuseau);
          const fichier = await this.tableau.excel(
            proprietaire,
            { du, au },
            frequence === 'SEMAINE' ? 'jour' : 'semaine',
          );
          const cle = await this.stockage.enregistrerRapport(fichier);
          await this.prisma.rapportArchive.create({
            data: { commerceId: c.id, frequence, du, au, fichierCle: cle, taille: fichier.length },
          });
          crees++;
        } catch (e) {
          this.journal.error(`Commerce ${c.id} : ${(e as Error).message}`);
        }
      }
    }
    return crees;
  }

  archives(commerceId: string) {
    return this.prisma.rapportArchive.findMany({
      where: { commerceId },
      orderBy: { du: 'desc' },
      take: 60,
      select: { id: true, frequence: true, du: true, au: true, taille: true, creeLe: true },
    });
  }

  async fichier(commerceId: string, id: string) {
    const archive = await this.prisma.rapportArchive.findFirst({ where: { id, commerceId } });
    const octets = archive ? await this.stockage.lireRapport(archive.fichierCle) : null;
    if (!archive || !octets) throw new NotFoundException('Rapport introuvable.');
    return { archive, octets };
  }
}
