import { Injectable } from '@nestjs/common';
import {
  bilanCaisse,
  CATEGORIES_DEPENSE,
  type CategorieDepense,
  libellePeriode,
  LIBELLES_CATEGORIES_DEPENSE,
  LIBELLES_MOYENS,
  type Montants,
  MOYENS_REMBOURSEMENT,
  type MoyenRemboursement,
  type Regroupement,
  rapportStock,
  rapportVentes,
  totalMontants,
} from '@gestvente/commun';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Periode {
  du: Date;
  au: Date;
}

const nombre = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Rapports de la boutique, calculés sur les données du serveur (gestion seulement). */
@Injectable()
export class RapportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async fuseau(commerceId: string) {
    const commerce = await this.prisma.commerce.findUniqueOrThrow({
      where: { id: commerceId },
      select: { fuseau: true },
    });
    return commerce.fuseau;
  }

  /** Chiffre d'affaires et bénéfice brut : total, par période, vendeur et produit. */
  async ventes(commerceId: string, boutiqueId: string, p: Periode, regroupement: Regroupement) {
    const [ventes, retours, fuseau] = await Promise.all([
      this.prisma.vente.findMany({
        where: { commerceId, boutiqueId, statut: 'VALIDEE', dateVente: { gte: p.du, lt: p.au } },
        include: { lignes: true },
      }),
      this.prisma.retour.findMany({
        where: { commerceId, boutiqueId, dateRetour: { gte: p.du, lt: p.au } },
        include: {
          lignes: { include: { ligneVente: true } },
          vente: { select: { vendeurId: true } },
        },
      }),
      this.fuseau(commerceId),
    ]);
    const r = rapportVentes(
      ventes.map((v) => ({
        date: v.dateVente.toISOString(),
        vendeurId: v.vendeurId,
        sousTotal: nombre(v.sousTotal),
        remise: nombre(v.remise),
        lignes: v.lignes.map((l) => ({
          produitId: l.produitId,
          quantite: l.quantite,
          total: nombre(l.total),
          prixAchat: nombre(l.prixAchat),
        })),
      })),
      retours.map((r) => ({
        date: r.dateRetour.toISOString(),
        vendeurId: r.vente.vendeurId,
        lignes: r.lignes.map((l) => ({
          produitId: l.ligneVente.produitId,
          quantite: l.quantite,
          montant: nombre(l.montant),
          coutUnitaire: nombre(l.ligneVente.prixAchat),
          destination: l.destination,
        })),
      })),
      regroupement,
      fuseau,
    );
    const [vendeurs, produits] = await Promise.all([
      this.prisma.utilisateur.findMany({
        where: { id: { in: r.parVendeur.map((v) => v.cle) } },
        select: { id: true, nom: true },
      }),
      this.prisma.produit.findMany({
        where: { id: { in: r.parProduit.map((v) => v.cle) } },
        select: { id: true, nom: true },
      }),
    ]);
    const nom = (liste: { id: string; nom: string }[], id: string) =>
      liste.find((x) => x.id === id)?.nom ?? '—';
    return {
      total: r.total,
      parPeriode: r.parPeriode.map((x) => ({ ...x, libelle: libellePeriode(x.cle) })),
      parVendeur: r.parVendeur.map((x) => ({ ...x, libelle: nom(vendeurs, x.cle) })),
      parProduit: r.parProduit.map((x) => ({ ...x, libelle: nom(produits, x.cle) })),
    };
  }

  /** Valeur du stock (achat, vente) et produits sans vente depuis `jours` jours. */
  async stock(commerceId: string, boutiqueId: string, jours: number) {
    const [produits, articles, dernieres] = await Promise.all([
      this.prisma.produit.findMany({
        where: { commerceId },
        include: {
          prixBoutiques: { where: { boutiqueId } },
          stocks: { where: { boutiqueId } },
        },
      }),
      this.prisma.article.findMany({
        where: { commerceId, boutiqueId, statut: { in: ['EN_STOCK', 'A_REPARER'] } },
        select: { produitId: true, prixAchat: true, prixRevente: true },
      }),
      this.prisma.$queryRaw<{ produitId: string; derniere: Date }[]>`
        SELECT l."produitId", MAX(v."dateVente") AS derniere
          FROM "LigneVente" l JOIN "Vente" v ON v.id = l."venteId"
         WHERE v."boutiqueId" = ${boutiqueId} AND v.statut = 'VALIDEE'
         GROUP BY l."produitId"`,
    ]);
    const r = rapportStock(
      produits.map((p) => {
        const pb = p.prixBoutiques[0];
        const detail = nombre(pb?.prixDetail ?? p.prixDetail);
        const derniere = dernieres.find((d) => d.produitId === p.id)?.derniere ?? null;
        if (p.type === 'TELEPHONE') {
          const siens = articles.filter((a) => a.produitId === p.id);
          return {
            produitId: p.id,
            nom: p.nom,
            quantite: siens.length,
            valeurAchat: siens.reduce((t, a) => t + nombre(a.prixAchat), 0),
            valeurVente: siens.reduce((t, a) => t + nombre(a.prixRevente ?? detail), 0),
            derniereVente: derniere?.toISOString() ?? null,
          };
        }
        const quantite = Math.max(0, p.stocks[0]?.quantite ?? 0);
        return {
          produitId: p.id,
          nom: p.nom,
          quantite,
          valeurAchat: quantite * nombre(pb?.prixAchat ?? p.prixAchat),
          valeurVente: quantite * detail,
          derniereVente: derniere?.toISOString() ?? null,
        };
      }),
      jours,
      new Date(),
    );
    return { jours, ...r };
  }

  /** Caisses de la période, encaissements par moyen et dépenses par catégorie. */
  async caisse(commerceId: string, boutiqueId: string, p: Periode) {
    const [caisses, ventes, retours, depenses] = await Promise.all([
      this.prisma.caisse.findMany({
        where: { commerceId, boutiqueId, ouverteLe: { gte: p.du, lt: p.au } },
        include: { utilisateur: { select: { nom: true } } },
        orderBy: { ouverteLe: 'asc' },
      }),
      this.prisma.vente.findMany({
        where: { commerceId, boutiqueId, dateVente: { gte: p.du, lt: p.au } },
        include: { paiements: true },
      }),
      this.prisma.retour.findMany({
        where: { commerceId, boutiqueId, dateRetour: { gte: p.du, lt: p.au } },
      }),
      this.prisma.depense.findMany({
        where: { commerceId, boutiqueId, dateDepense: { gte: p.du, lt: p.au } },
        orderBy: { dateDepense: 'asc' },
      }),
    ]);
    const reel = (m: string) => (m === 'AVOIR' ? null : (m as MoyenRemboursement));
    const bilan = bilanCaisse({
      fondInitial: 0,
      ventes: ventes.map((v) => ({
        statut: v.statut,
        renduMonnaie: nombre(v.renduMonnaie),
        paiements: v.paiements.map((x) => ({ moyen: x.moyen, montant: nombre(x.montant) })),
      })),
      retours: retours.map((r) => ({
        montantRembourse: nombre(r.montantRembourse),
        moyenRemboursement: r.moyenRemboursement ? reel(r.moyenRemboursement) : null,
      })),
      depenses: depenses.map((d) => ({
        montant: nombre(d.montant),
        moyen: reel(d.moyen) ?? 'ESPECES',
      })),
    });
    const parCategorie = CATEGORIES_DEPENSE.map((c) => ({
      categorie: c,
      libelle: LIBELLES_CATEGORIES_DEPENSE[c],
      montant: depenses.filter((d) => d.categorie === c).reduce((t, d) => t + nombre(d.montant), 0),
    })).filter((c) => c.montant > 0);
    return {
      encaisse: bilan.encaisse,
      rembourse: bilan.rembourse,
      /** Solde des mouvements de la période (encaissé − remboursé − dépensé). */
      solde: bilan.theorique,
      caisses: caisses.map((c) => ({
        id: c.id,
        vendeur: c.utilisateur.nom,
        statut: c.statut,
        ouverteLe: c.ouverteLe.toISOString(),
        clotureeLe: c.clotureeLe?.toISOString() ?? null,
        fondInitial: nombre(c.fondInitial),
        attendu: c.theorique ? totalMontants(c.theorique as Montants) : null,
        compte: c.comptage ? totalMontants(c.comptage as Montants) : null,
        ecart: c.ecart === null ? null : nombre(c.ecart),
      })),
      depenses: {
        total: depenses.reduce((t, d) => t + nombre(d.montant), 0),
        horsCaisse: depenses.filter((d) => !d.caisseId).reduce((t, d) => t + nombre(d.montant), 0),
        parCategorie,
        liste: depenses.map((d) => ({
          date: d.dateDepense.toISOString(),
          categorie: d.categorie as CategorieDepense,
          libelle: d.libelle,
          montant: nombre(d.montant),
          enCaisse: d.caisseId !== null,
        })),
      },
    };
  }

  /** Classeur Excel d'un rapport (une feuille par tableau). */
  async excel(
    type: 'ventes' | 'stock' | 'caisse',
    commerceId: string,
    boutiqueId: string,
    p: Periode,
    regroupement: Regroupement,
    jours: number,
  ): Promise<Buffer> {
    const classeur = new ExcelJS.Workbook();
    classeur.creator = 'GestVente Phone';
    const feuille = (nom: string, colonnes: string[], lignes: (string | number)[][]) => {
      const f = classeur.addWorksheet(nom);
      f.addRow(colonnes).font = { bold: true };
      for (const l of lignes) f.addRow(l);
      f.columns.forEach((c, i) => {
        c.width = Math.max(
          12,
          ...[colonnes[i] ?? '', ...lignes.map((l) => String(l[i] ?? ''))].map((t) => t.length + 2),
        );
        if (i > 0) c.numFmt = '#,##0';
      });
      f.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const colonnesChiffres = ['CA net', 'Ventes', 'Retours', 'Coût', 'Bénéfice brut', 'Quantité'];
    const chiffres = (c: {
      chiffreAffaires: number;
      ventes: number;
      retours: number;
      cout: number;
      benefice: number;
      quantite: number;
    }) => [c.chiffreAffaires, c.ventes, c.retours, c.cout, c.benefice, c.quantite];

    if (type === 'ventes') {
      const r = await this.ventes(commerceId, boutiqueId, p, regroupement);
      feuille(
        'Périodes',
        ['Période', ...colonnesChiffres, 'Nombre de ventes'],
        [
          ...r.parPeriode.map((x) => [x.libelle, ...chiffres(x), x.nombreVentes]),
          ['Total', ...chiffres(r.total), r.total.nombreVentes],
        ],
      );
      feuille(
        'Vendeurs',
        ['Vendeur', ...colonnesChiffres, 'Nombre de ventes'],
        r.parVendeur.map((x) => [x.libelle, ...chiffres(x), x.nombreVentes]),
      );
      feuille(
        'Produits',
        ['Produit', ...colonnesChiffres],
        r.parProduit.map((x) => [x.libelle, ...chiffres(x)]),
      );
    } else if (type === 'stock') {
      const r = await this.stock(commerceId, boutiqueId, jours);
      feuille(
        'Stock',
        ['Produit', 'Quantité', 'Valeur d’achat', 'Valeur de vente'],
        [
          ...r.produits.map((x) => [x.nom, x.quantite, x.valeurAchat, x.valeurVente]),
          ['Total', r.quantite, r.valeurAchat, r.valeurVente],
        ],
      );
      feuille(
        `Sans vente ${jours} j`,
        ['Produit', 'Quantité', 'Valeur d’achat', 'Dernière vente'],
        r.sansVente.map((x) => [
          x.nom,
          x.quantite,
          x.valeurAchat,
          x.derniereVente ? new Date(x.derniereVente).toLocaleDateString('fr-FR') : 'jamais',
        ]),
      );
    } else {
      const r = await this.caisse(commerceId, boutiqueId, p);
      feuille(
        'Moyens de paiement',
        ['Moyen', 'Encaissé', 'Remboursé', 'Solde'],
        MOYENS_REMBOURSEMENT.map((m) => [
          LIBELLES_MOYENS[m],
          r.encaisse[m],
          r.rembourse[m],
          r.solde[m],
        ]),
      );
      feuille(
        'Caisses',
        ['Vendeur', 'Ouverte le', 'Statut', 'Fond', 'Attendu', 'Compté', 'Écart'],
        r.caisses.map((c) => [
          c.vendeur,
          new Date(c.ouverteLe).toLocaleString('fr-FR'),
          c.statut,
          c.fondInitial,
          c.attendu ?? '',
          c.compte ?? '',
          c.ecart ?? '',
        ]),
      );
      feuille(
        'Dépenses',
        ['Date', 'Catégorie', 'Libellé', 'Montant', 'Origine'],
        r.depenses.liste.map((d) => [
          new Date(d.date).toLocaleDateString('fr-FR'),
          LIBELLES_CATEGORIES_DEPENSE[d.categorie],
          d.libelle,
          d.montant,
          d.enCaisse ? 'Caisse' : 'Hors caisse',
        ]),
      );
    }
    return Buffer.from(await classeur.xlsx.writeBuffer());
  }
}
