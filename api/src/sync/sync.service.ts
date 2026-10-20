import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type Changement,
  type DonneesEntites,
  type EntiteSync,
  erreurContenu,
  type Instantane,
  LIBELLES_OPERATIONS,
  type Operation,
  type PageChangements,
  type ResultatOperation,
  type StatutOperation,
  type TypeOperation,
} from '@gestvente/commun';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dettesFournisseurs } from '../clients/clients.ecritures.js';
import { Role } from '../generated/prisma/enums.js';
import { JournalService } from './journal.service.js';
import type { ConflitDto } from './sync.dto.js';
import { GESTIONNAIRES } from './operations/index.js';
import type { Gestionnaire } from './operations/gestionnaire.js';
import {
  masquerPourRole,
  versArticle,
  versCategorie,
  versClient,
  versCompatibilite,
  versFournisseur,
  versGarant,
  versMarque,
  versModele,
  versPrixBoutique,
  versProduit,
  versStock,
} from './serialisation.js';

export const LIMITE_CHANGEMENTS = 500;
export const LIMITE_CHANGEMENTS_MAX = 1000;

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Applique un lot d'opérations dans l'ordre. Idempotent : une opération déjà
   * reçue n'est jamais rejouée, son résultat est renvoyé tel quel (l'appareil
   * renvoie le même lot si la réponse s'est perdue).
   */
  async appliquerLot(
    utilisateur: UtilisateurConnecte,
    operations: Operation[],
  ): Promise<ResultatOperation[]> {
    const resultats: ResultatOperation[] = [];
    for (const operation of operations) {
      resultats.push(await this.appliquer(utilisateur, operation));
    }
    return resultats;
  }

  private async appliquer(
    utilisateur: UtilisateurConnecte,
    operation: Operation,
  ): Promise<ResultatOperation> {
    const deja = await this.prisma.operationSync.findUnique({ where: { id: operation.id } });
    if (deja) return this.resultatExistant(utilisateur, operation, deja);

    const gestionnaire = GESTIONNAIRES[operation.type] as Gestionnaire<TypeOperation>;
    let statut: StatutOperation = 'APPLIQUEE';
    let motif: string | undefined;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.journal.verrouiller(tx, utilisateur.commerceId);
        const controle = await this.controler(utilisateur, operation, gestionnaire);
        const resultat = controle.ok
          ? await gestionnaire.appliquer(
              { tx, utilisateur, operation, journal: this.journal, audit: this.audit },
              operation.contenu as never,
            )
          : controle;
        if (!resultat.ok) {
          statut = resultat.statut;
          motif = resultat.motif;
        }
        await tx.operationSync.create({
          data: {
            id: operation.id,
            commerceId: utilisateur.commerceId,
            appareilId: utilisateur.appareilId,
            utilisateurId: utilisateur.id,
            boutiqueId: operation.boutiqueId,
            type: operation.type,
            contenu: operation.contenu as Prisma.InputJsonValue,
            statut,
            motif,
            faiteLe: new Date(operation.faiteLe),
          },
        });
      });
    } catch (erreur) {
      // Même opération reçue deux fois en même temps : la transaction perdante est
      // annulée en entier (aucun double effet) et renvoie le résultat de l'autre.
      if (!(erreur instanceof Prisma.PrismaClientKnownRequestError) || erreur.code !== 'P2002') {
        throw erreur;
      }
      const existante = await this.prisma.operationSync.findUniqueOrThrow({
        where: { id: operation.id },
      });
      return this.resultatExistant(utilisateur, operation, existante);
    }
    return this.resultat(operation, gestionnaire, statut, motif);
  }

  /** Droits et validité de l'opération, avant toute écriture. */
  private async controler(
    utilisateur: UtilisateurConnecte,
    operation: Operation,
    gestionnaire: Gestionnaire<TypeOperation>,
  ): Promise<{ ok: true } | { ok: false; statut: 'REJETEE'; motif: string }> {
    if (!utilisateur.boutiqueIds.includes(operation.boutiqueId)) {
      return { ok: false, statut: 'REJETEE', motif: "Vous n'êtes pas rattaché à cette boutique." };
    }
    if (!gestionnaire.roles.includes(utilisateur.role)) {
      return {
        ok: false,
        statut: 'REJETEE',
        motif: `Votre rôle ne permet pas : ${LIBELLES_OPERATIONS[operation.type].toLowerCase()}.`,
      };
    }
    const erreur = erreurContenu(operation.type, operation.contenu);
    return erreur ? { ok: false, statut: 'REJETEE', motif: erreur } : { ok: true };
  }

  private async resultatExistant(
    utilisateur: UtilisateurConnecte,
    operation: Operation,
    deja: { commerceId: string; appareilId: string; statut: StatutOperation; motif: string | null },
  ): Promise<ResultatOperation> {
    if (deja.commerceId !== utilisateur.commerceId || deja.appareilId !== utilisateur.appareilId) {
      return {
        id: operation.id,
        statut: 'REJETEE',
        motif: "Identifiant d'opération déjà utilisé.",
      };
    }
    const gestionnaire = GESTIONNAIRES[operation.type] as Gestionnaire<TypeOperation>;
    return this.resultat(operation, gestionnaire, deja.statut, deja.motif ?? undefined);
  }

  /** Résultat renvoyé à l'appareil ; rejet ou conflit : avec l'état du serveur à remettre. */
  private async resultat(
    operation: Operation,
    gestionnaire: Gestionnaire<TypeOperation>,
    statut: StatutOperation,
    motif?: string,
  ): Promise<ResultatOperation> {
    if (statut === 'APPLIQUEE') return { id: operation.id, statut };
    const valide = erreurContenu(operation.type, operation.contenu) === null;
    const corrections = valide
      ? await gestionnaire.corrections(this.prisma, operation, operation.contenu as never)
      : [];
    return { id: operation.id, statut, motif, corrections };
  }

  /** Données complètes des boutiques de l'utilisateur, pour remplir une base locale vide. */
  async instantane(utilisateur: UtilisateurConnecte): Promise<Instantane> {
    const { commerceId, boutiqueIds, role } = utilisateur;
    return this.prisma.$transaction(
      async (tx) => {
        const dernier = await tx.changement.aggregate({
          where: { commerceId },
          _max: { seq: true },
        });
        const [marques, modeles, categories, produits, prix, compatibilites, stocks, articles] =
          await Promise.all([
            tx.marque.findMany({ where: { commerceId } }),
            tx.modele.findMany({ where: { commerceId } }),
            tx.categorie.findMany({ where: { commerceId } }),
            tx.produit.findMany({ where: { commerceId } }),
            tx.prixBoutique.findMany({ where: { boutiqueId: { in: boutiqueIds } } }),
            tx.compatibilite.findMany({ where: { accessoire: { commerceId } } }),
            tx.stock.findMany({ where: { boutiqueId: { in: boutiqueIds } } }),
            tx.article.findMany({
              where: {
                commerceId,
                boutiqueId: { in: boutiqueIds },
                statut: { in: ['EN_STOCK', 'A_REPARER', 'EN_TRANSFERT'] },
              },
            }),
          ]);
        const masquer = <E extends EntiteSync>(entite: E, liste: DonneesEntites[E][]) =>
          liste.map((d) => masquerPourRole(entite, d, role) as DonneesEntites[E]);
        const clients = await tx.client.findMany({ where: { commerceId } });
        const garants = await tx.garant.findMany({ where: { client: { commerceId } } });
        // Fournisseurs : propriétaire et gérants seulement.
        const fournisseurs =
          role === Role.VENDEUR ? [] : await tx.fournisseur.findMany({ where: { commerceId } });
        const dettes = fournisseurs.length ? await dettesFournisseurs(tx, commerceId) : new Map();
        return {
          curseur: Number(dernier._max.seq ?? 0n),
          donnees: {
            marque: marques.map(versMarque),
            modele: modeles.map(versModele),
            categorie: categories.map(versCategorie),
            produit: masquer('produit', produits.map(versProduit)),
            prixBoutique: masquer('prixBoutique', prix.map(versPrixBoutique)),
            compatibilite: compatibilites.map(versCompatibilite),
            stock: stocks.map(versStock),
            article: masquer('article', articles.map(versArticle)),
            client: clients.map(versClient),
            garant: garants.map(versGarant),
            fournisseur: fournisseurs.map((f) => versFournisseur(f, dettes.get(f.id) ?? 0)),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Changements depuis le curseur, pour le catalogue et les boutiques de l'utilisateur. */
  async changements(
    utilisateur: UtilisateurConnecte,
    curseur: number,
    limite = LIMITE_CHANGEMENTS,
  ): Promise<PageChangements> {
    const { commerceId, boutiqueIds, role } = utilisateur;
    // Borne lue d'abord : un changement validé pendant la lecture sera vu la fois suivante.
    const dernier = await this.prisma.changement.aggregate({
      where: { commerceId },
      _max: { seq: true },
    });
    const borne = dernier._max.seq ?? 0n;
    const lignes = await this.prisma.changement.findMany({
      where: {
        commerceId,
        seq: { gt: BigInt(curseur), lte: borne },
        OR: [{ boutiqueId: null }, { boutiqueId: { in: boutiqueIds } }],
      },
      orderBy: { seq: 'asc' },
      take: limite,
    });
    const plus = lignes.length === limite;
    return {
      changements: lignes.map(
        (l) =>
          ({
            seq: Number(l.seq),
            entite: l.entite,
            id: l.entiteId,
            donnees: masquerPourRole(
              l.entite as EntiteSync,
              l.donnees as DonneesEntites[EntiteSync] | null,
              role,
            ),
          }) as Changement,
      ),
      curseur: plus ? Number(lignes[lignes.length - 1].seq) : Math.max(curseur, Number(borne)),
      plus,
    };
  }

  /** Conflits non traités des boutiques de l'utilisateur (gérant, propriétaire). */
  async conflits(utilisateur: UtilisateurConnecte): Promise<ConflitDto[]> {
    const operations = await this.prisma.operationSync.findMany({
      where: {
        commerceId: utilisateur.commerceId,
        statut: 'CONFLIT',
        resoluLe: null,
        boutiqueId: { in: utilisateur.boutiqueIds },
      },
      orderBy: { recueLe: 'desc' },
      take: 200,
    });
    const auteurs = await this.prisma.utilisateur.findMany({
      where: { id: { in: [...new Set(operations.map((o) => o.utilisateurId))] } },
      select: { id: true, nom: true },
    });
    return operations.map((o) => ({
      id: o.id,
      type: o.type as TypeOperation,
      libelle: LIBELLES_OPERATIONS[o.type as TypeOperation] ?? o.type,
      boutiqueId: o.boutiqueId,
      motif: o.motif,
      faiteLe: o.faiteLe,
      recueLe: o.recueLe,
      contenu: o.contenu,
      utilisateur: auteurs.find((a) => a.id === o.utilisateurId) ?? null,
    }));
  }

  /** Le gérant a traité le conflit (vérifié en boutique, client recontacté…). */
  async traiterConflit(utilisateur: UtilisateurConnecte, id: string): Promise<void> {
    const { count } = await this.prisma.operationSync.updateMany({
      where: {
        id,
        commerceId: utilisateur.commerceId,
        statut: 'CONFLIT',
        resoluLe: null,
        boutiqueId: { in: utilisateur.boutiqueIds },
      },
      data: { resoluLe: new Date(), resoluParId: utilisateur.id },
    });
    if (count === 0) throw new NotFoundException('Conflit introuvable ou déjà traité.');
    await this.audit.journaliser({
      commerceId: utilisateur.commerceId,
      action: ACTIONS_AUDIT.CONFLIT_TRAITE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'OperationSync',
      entiteId: id,
    });
  }
}
