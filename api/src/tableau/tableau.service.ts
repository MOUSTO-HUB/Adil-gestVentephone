import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  type ChiffresBoutique,
  evolution,
  jourLocal,
  libellePeriode,
  periodePrecedente,
  type Regroupement,
  situationTrocs,
  totaliser,
} from '@gestvente/commun';
import ExcelJS from 'exceljs';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { BOUTIQUE_OUVERTE } from '../auth/acces.regles.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Periode {
  du: Date;
  au: Date;
}

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Format de regroupement des dates en SQL, au fuseau du commerce. */
const FORMATS: Record<Regroupement, string> = {
  jour: 'YYYY-MM-DD',
  semaine: 'IYYY-"S"IW',
  mois: 'YYYY-MM',
};

/**
 * Tableau de bord consolidé : chiffres de chaque boutique en requêtes agrégées
 * (index sur boutique et date), comparaison avec la période précédente, évolution du
 * chiffre d'affaires par période et par boutique, situation des trocs.
 */
@Injectable()
export class TableauService {
  constructor(private readonly prisma: PrismaService) {}

  /** Boutiques visées : toutes celles de l'utilisateur, ou une seule qu'il gère. */
  async boutiques(u: UtilisateurConnecte, boutiqueId?: string) {
    if (boutiqueId && !u.boutiqueIds.includes(boutiqueId)) {
      throw new ForbiddenException('Boutique à laquelle vous n’êtes pas rattaché.');
    }
    return this.prisma.boutique.findMany({
      where: {
        commerceId: u.commerceId,
        id: { in: boutiqueId ? [boutiqueId] : u.boutiqueIds },
        ...BOUTIQUE_OUVERTE,
      },
      select: { id: true, nom: true },
      orderBy: { nom: 'asc' },
    });
  }

  /** Chiffre d'affaires, coût et nombre de ventes par boutique (remise au prorata de chaque ligne). */
  private async ventes(commerceId: string, ids: string[], p: Periode) {
    const ventes = await this.prisma.$queryRaw<
      { boutiqueId: string; nombre: number; ventes: bigint; cout: bigint }[]
    >`
      SELECT v."boutiqueId", COUNT(DISTINCT v.id)::int AS nombre,
             COALESCE(SUM(CASE WHEN v."sousTotal" > 0
               THEN ROUND(l.total * (v."sousTotal" - v.remise)::numeric / v."sousTotal") ELSE 0 END), 0)::bigint AS ventes,
             COALESCE(SUM(l."prixAchat" * l.quantite), 0)::bigint AS cout
        FROM "Vente" v JOIN "LigneVente" l ON l."venteId" = v.id
       WHERE v."commerceId" = ${commerceId} AND v."boutiqueId" = ANY(${ids}::text[])
         AND v.statut = 'VALIDEE' AND v."dateVente" >= ${p.du} AND v."dateVente" < ${p.au}
       GROUP BY v."boutiqueId"`;
    const retours = await this.prisma.$queryRaw<
      { boutiqueId: string; montant: bigint; recupere: bigint }[]
    >`
      SELECT r."boutiqueId", COALESCE(SUM(lr.montant), 0)::bigint AS montant,
             COALESCE(SUM(CASE WHEN lr.destination <> 'REBUT' THEN lv."prixAchat" * lr.quantite ELSE 0 END), 0)::bigint AS recupere
        FROM "Retour" r
        JOIN "LigneRetour" lr ON lr."retourId" = r.id
        JOIN "LigneVente" lv ON lv.id = lr."ligneVenteId"
       WHERE r."commerceId" = ${commerceId} AND r."boutiqueId" = ANY(${ids}::text[])
         AND r."dateRetour" >= ${p.du} AND r."dateRetour" < ${p.au}
       GROUP BY r."boutiqueId"`;
    return new Map(
      ids.map((id) => {
        const v = ventes.find((x) => x.boutiqueId === id);
        const r = retours.find((x) => x.boutiqueId === id);
        const chiffreAffaires = n(v?.ventes) - n(r?.montant);
        const cout = n(v?.cout) - n(r?.recupere);
        return [
          id,
          { chiffreAffaires, benefice: chiffreAffaires - cout, nombreVentes: v?.nombre ?? 0 },
        ];
      }),
    );
  }

  /** Chiffres de chaque boutique sur la période. */
  async chiffres(commerceId: string, boutiques: { id: string; nom: string }[], p: Periode) {
    const ids = boutiques.map((b) => b.id);
    const commerce = await this.prisma.commerce.findUniqueOrThrow({
      where: { id: commerceId },
      select: { fuseau: true },
    });
    const aujourdhui = new Date(`${jourLocal(new Date(), commerce.fuseau)}T00:00:00.000Z`);
    const [ventes, telephones, accessoires, credits, retards, depenses, caisses, syncs] =
      await Promise.all([
        this.ventes(commerceId, ids, p),
        this.prisma.$queryRaw<{ boutiqueId: string; achat: bigint; vente: bigint }[]>`
          SELECT a."boutiqueId", COALESCE(SUM(a."prixAchat"), 0)::bigint AS achat,
                 COALESCE(SUM(COALESCE(a."prixRevente", pb."prixDetail", p."prixDetail")), 0)::bigint AS vente
            FROM "Article" a JOIN "Produit" p ON p.id = a."produitId"
            LEFT JOIN "PrixBoutique" pb ON pb."produitId" = a."produitId" AND pb."boutiqueId" = a."boutiqueId"
           WHERE a."commerceId" = ${commerceId} AND a."boutiqueId" = ANY(${ids}::text[])
             AND a.statut IN ('EN_STOCK', 'A_REPARER')
           GROUP BY a."boutiqueId"`,
        this.prisma.$queryRaw<{ boutiqueId: string; achat: bigint; vente: bigint }[]>`
          SELECT s."boutiqueId",
                 COALESCE(SUM(GREATEST(s.quantite, 0) * COALESCE(pb."prixAchat", p."prixAchat")), 0)::bigint AS achat,
                 COALESCE(SUM(GREATEST(s.quantite, 0) * COALESCE(pb."prixDetail", p."prixDetail")), 0)::bigint AS vente
            FROM "Stock" s JOIN "Produit" p ON p.id = s."produitId" AND p.type = 'ACCESSOIRE'
            LEFT JOIN "PrixBoutique" pb ON pb."produitId" = s."produitId" AND pb."boutiqueId" = s."boutiqueId"
           WHERE s."boutiqueId" = ANY(${ids}::text[])
           GROUP BY s."boutiqueId"`,
        this.prisma.credit.groupBy({
          by: ['boutiqueId'],
          where: { commerceId, boutiqueId: { in: ids }, statut: 'EN_COURS' },
          _count: { _all: true },
          _sum: { montantRestant: true },
        }),
        this.prisma.$queryRaw<{ boutiqueId: string; nombre: number; echu: bigint }[]>`
          SELECT c."boutiqueId", COUNT(DISTINCT c.id)::int AS nombre,
                 COALESCE(SUM(e.montant + e.penalite - e."montantPaye"), 0)::bigint AS echu
            FROM "Echeance" e JOIN "Credit" c ON c.id = e."creditId"
           WHERE c."commerceId" = ${commerceId} AND c."boutiqueId" = ANY(${ids}::text[])
             AND c.statut = 'EN_COURS' AND e."dateEcheance" < ${aujourdhui}
             AND e.montant + e.penalite > e."montantPaye"
           GROUP BY c."boutiqueId"`,
        this.prisma.depense.groupBy({
          by: ['boutiqueId'],
          where: { commerceId, boutiqueId: { in: ids }, dateDepense: { gte: p.du, lt: p.au } },
          _sum: { montant: true },
        }),
        this.prisma.caisse.findMany({
          where: {
            commerceId,
            boutiqueId: { in: ids },
            OR: [
              { statut: { in: ['OUVERTE', 'CLOTUREE'] } },
              { clotureeLe: { gte: p.du, lt: p.au } },
            ],
          },
          select: { boutiqueId: true, statut: true, ecart: true, clotureeLe: true },
        }),
        this.prisma.operationSync.groupBy({
          by: ['boutiqueId'],
          where: { commerceId, boutiqueId: { in: ids } },
          _max: { recueLe: true },
        }),
      ]);
    return boutiques.map((b): ChiffresBoutique => {
      const tel = telephones.find((x) => x.boutiqueId === b.id);
      const acc = accessoires.find((x) => x.boutiqueId === b.id);
      const cr = credits.find((x) => x.boutiqueId === b.id);
      const re = retards.find((x) => x.boutiqueId === b.id);
      const siennes = caisses.filter((c) => c.boutiqueId === b.id);
      const sync = syncs.find((x) => x.boutiqueId === b.id)?._max.recueLe;
      return {
        boutiqueId: b.id,
        nom: b.nom,
        ...ventes.get(b.id)!,
        stockAchat: n(tel?.achat) + n(acc?.achat),
        stockVente: n(tel?.vente) + n(acc?.vente),
        creditsEnCours: cr?._count._all ?? 0,
        creditsDu: n(cr?._sum.montantRestant),
        creditsEnRetard: re?.nombre ?? 0,
        creditsEchus: n(re?.echu),
        depenses: n(depenses.find((x) => x.boutiqueId === b.id)?._sum.montant),
        ecartsCaisse: siennes
          .filter((c) => c.clotureeLe && c.clotureeLe >= p.du && c.clotureeLe < p.au)
          .reduce((t, c) => t + n(c.ecart), 0),
        caissesOuvertes: siennes.filter((c) => c.statut === 'OUVERTE').length,
        caissesAValider: siennes.filter((c) => c.statut === 'CLOTUREE').length,
        derniereSync: sync?.toISOString() ?? null,
      };
    });
  }

  /** Chiffre d'affaires par période et par boutique (comparaison entre boutiques). */
  async series(commerceId: string, ids: string[], p: Periode, regroupement: Regroupement) {
    const { fuseau } = await this.prisma.commerce.findUniqueOrThrow({
      where: { id: commerceId },
      select: { fuseau: true },
    });
    const format = FORMATS[regroupement];
    const lignes = await this.prisma.$queryRaw<
      { cle: string; boutiqueId: string; montant: bigint }[]
    >`
      SELECT cle, "boutiqueId", SUM(montant)::bigint AS montant FROM (
        SELECT to_char(v."dateVente" AT TIME ZONE ${fuseau}, ${format}) AS cle, v."boutiqueId",
               CASE WHEN v."sousTotal" > 0
                 THEN ROUND(l.total * (v."sousTotal" - v.remise)::numeric / v."sousTotal") ELSE 0 END AS montant
          FROM "Vente" v JOIN "LigneVente" l ON l."venteId" = v.id
         WHERE v."commerceId" = ${commerceId} AND v."boutiqueId" = ANY(${ids}::text[])
           AND v.statut = 'VALIDEE' AND v."dateVente" >= ${p.du} AND v."dateVente" < ${p.au}
        UNION ALL
        SELECT to_char(r."dateRetour" AT TIME ZONE ${fuseau}, ${format}), r."boutiqueId", -lr.montant
          FROM "Retour" r JOIN "LigneRetour" lr ON lr."retourId" = r.id
         WHERE r."commerceId" = ${commerceId} AND r."boutiqueId" = ANY(${ids}::text[])
           AND r."dateRetour" >= ${p.du} AND r."dateRetour" < ${p.au}
      ) t GROUP BY cle, "boutiqueId" ORDER BY cle`;
    const cles = [...new Set(lignes.map((l) => l.cle))];
    return cles.map((cle) => ({
      cle,
      libelle: libellePeriode(cle),
      valeurs: Object.fromEntries(
        ids.map((id) => [id, n(lignes.find((l) => l.cle === cle && l.boutiqueId === id)?.montant)]),
      ) as Record<string, number>,
    }));
  }

  /** Tableau de bord : boutiques, total, période précédente, évolution, séries. */
  async tableau(
    u: UtilisateurConnecte,
    p: Periode,
    regroupement: Regroupement,
    boutiqueId?: string,
  ) {
    const boutiques = await this.boutiques(u, boutiqueId);
    const ids = boutiques.map((b) => b.id);
    const avant = periodePrecedente(p.du, p.au);
    const [actuels, precedents, series] = await Promise.all([
      this.chiffres(u.commerceId, boutiques, p),
      this.ventes(u.commerceId, ids, avant),
      this.series(u.commerceId, ids, p, regroupement),
    ]);
    const total = totaliser(actuels);
    const precedent = [...precedents.values()].reduce(
      (t, x) => ({
        chiffreAffaires: t.chiffreAffaires + x.chiffreAffaires,
        benefice: t.benefice + x.benefice,
        nombreVentes: t.nombreVentes + x.nombreVentes,
      }),
      { chiffreAffaires: 0, benefice: 0, nombreVentes: 0 },
    );
    return {
      du: p.du.toISOString(),
      au: p.au.toISOString(),
      boutiques: actuels.map((b) => ({
        ...b,
        evolution: evolution(b.chiffreAffaires, precedents.get(b.boutiqueId)?.chiffreAffaires ?? 0),
      })),
      total,
      precedent,
      evolution: {
        chiffreAffaires: evolution(total.chiffreAffaires, precedent.chiffreAffaires),
        benefice: evolution(total.benefice, precedent.benefice),
        nombreVentes: evolution(total.nombreVentes, precedent.nombreVentes),
      },
      series,
    };
  }

  /** Situation des trocs de la période, par boutique et au total. */
  async trocs(u: UtilisateurConnecte, p: Periode, boutiqueId?: string) {
    const boutiques = await this.boutiques(u, boutiqueId);
    const trocs = await this.prisma.troc.findMany({
      where: {
        commerceId: u.commerceId,
        boutiqueId: { in: boutiques.map((b) => b.id) },
        creeLe: { gte: p.du, lt: p.au },
      },
      include: { article: { select: { id: true, statut: true } } },
    });
    const articleIds = trocs.flatMap((t) => (t.article ? [t.article.id] : []));
    const [repares, reventes] = await Promise.all([
      this.prisma.journalAudit.findMany({
        where: {
          commerceId: u.commerceId,
          action: 'REMISE_EN_VENTE',
          entiteId: { in: articleIds },
        },
        select: { entiteId: true, creeLe: true },
      }),
      this.prisma.ligneVente.findMany({
        where: { articleId: { in: articleIds }, vente: { statut: 'VALIDEE' } },
        select: { articleId: true, prixUnitaire: true, vente: { select: { dateVente: true } } },
      }),
    ]);
    const situation = (liste: typeof trocs) =>
      situationTrocs(
        liste.map((t) => {
          const revente = reventes
            .filter((r) => r.articleId === t.articleId && r.vente.dateVente > t.creeLe)
            .sort((a, b) => b.vente.dateVente.getTime() - a.vente.dateVente.getTime())[0];
          return {
            valeurRetenue: n(t.valeurRetenue),
            statutArticle: t.article?.statut ?? null,
            repare: repares.some((r) => r.entiteId === t.articleId && r.creeLe > t.creeLe),
            prixRevente: revente ? n(revente.prixUnitaire) : null,
          };
        }),
      );
    return {
      total: situation(trocs),
      boutiques: boutiques.map((b) => ({
        boutiqueId: b.id,
        nom: b.nom,
        ...situation(trocs.filter((t) => t.boutiqueId === b.id)),
      })),
    };
  }

  /** Classeur consolidé : synthèse par boutique, évolution, trocs. */
  async excel(u: UtilisateurConnecte, p: Periode, regroupement: Regroupement, boutiqueId?: string) {
    const [t, trocs] = await Promise.all([
      this.tableau(u, p, regroupement, boutiqueId),
      this.trocs(u, p, boutiqueId),
    ]);
    const classeur = new ExcelJS.Workbook();
    classeur.creator = 'GestVente Phone';
    const synthese = classeur.addWorksheet('Synthèse');
    synthese.columns = [
      { header: 'Boutique', key: 'nom', width: 26 },
      { header: 'Chiffre d’affaires', key: 'chiffreAffaires', width: 18 },
      { header: 'Évolution (%)', key: 'evolution', width: 14 },
      { header: 'Bénéfice brut', key: 'benefice', width: 16 },
      { header: 'Ventes', key: 'nombreVentes', width: 10 },
      { header: 'Stock (achat)', key: 'stockAchat', width: 16 },
      { header: 'Stock (vente)', key: 'stockVente', width: 16 },
      { header: 'Crédits en cours', key: 'creditsEnCours', width: 16 },
      { header: 'Reste dû', key: 'creditsDu', width: 14 },
      { header: 'Crédits en retard', key: 'creditsEnRetard', width: 16 },
      { header: 'Échu', key: 'creditsEchus', width: 14 },
      { header: 'Dépenses', key: 'depenses', width: 14 },
      { header: 'Écarts de caisse', key: 'ecartsCaisse', width: 16 },
      { header: 'Dernière synchronisation', key: 'derniereSync', width: 24 },
    ];
    for (const b of t.boutiques) synthese.addRow(b);
    const ligneTotal = synthese.addRow({
      ...t.total,
      nom: 'Toutes les boutiques',
      evolution: t.evolution.chiffreAffaires,
    });
    ligneTotal.font = { bold: true };
    synthese.getRow(1).font = { bold: true };

    const evol = classeur.addWorksheet('Évolution');
    evol.columns = [
      { header: 'Période', key: 'libelle', width: 22 },
      ...t.boutiques.map((b) => ({ header: b.nom, key: b.boutiqueId, width: 20 })),
    ];
    for (const s of t.series) evol.addRow({ libelle: s.libelle, ...s.valeurs });
    evol.getRow(1).font = { bold: true };

    const feuilleTrocs = classeur.addWorksheet('Trocs');
    feuilleTrocs.columns = [
      { header: 'Boutique', key: 'nom', width: 26 },
      { header: 'Repris', key: 'repris', width: 10 },
      { header: 'Valeur de reprise', key: 'valeurReprise', width: 18 },
      { header: 'À réparer', key: 'aReparer', width: 12 },
      { header: 'Réparés', key: 'repares', width: 10 },
      { header: 'En vente', key: 'enVente', width: 10 },
      { header: 'Revendus', key: 'revendus', width: 10 },
      { header: 'Ventes des revendus', key: 'ventesRevendus', width: 20 },
      { header: 'Marge', key: 'marge', width: 14 },
    ];
    for (const b of trocs.boutiques) feuilleTrocs.addRow(b);
    feuilleTrocs.addRow({ ...trocs.total, nom: 'Toutes les boutiques' }).font = { bold: true };
    feuilleTrocs.getRow(1).font = { bold: true };
    return Buffer.from(await classeur.xlsx.writeBuffer());
  }

  /** Utilisateur fictif « propriétaire » d'un commerce (rapports planifiés). */
  async proprietaireVirtuel(commerceId: string): Promise<UtilisateurConnecte> {
    const boutiques = await this.prisma.boutique.findMany({
      where: { commerceId, ...BOUTIQUE_OUVERTE },
      select: { id: true },
    });
    return {
      id: 'tache-planifiee',
      role: Role.PROPRIETAIRE,
      commerceId,
      appareilId: 'tache-planifiee',
      boutiqueIds: boutiques.map((b) => b.id),
    } as UtilisateurConnecte;
  }
}
