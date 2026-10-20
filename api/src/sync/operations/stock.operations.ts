import {
  type Changement,
  controlerAjustementStock,
  controlerSortieArticle,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../../audit/audit.service.js';
import { Role } from '../../generated/prisma/enums.js';
import type { Tx } from '../journal.service.js';
import { versArticle, versStock } from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

const GESTION = [Role.PROPRIETAIRE, Role.GERANT];

async function stockDe(tx: Tx, produitId: string, boutiqueId: string) {
  return tx.stock.findUnique({ where: { produitId_boutiqueId: { produitId, boutiqueId } } });
}

async function correctionStock(
  tx: Tx,
  produitId: string,
  boutiqueId: string,
): Promise<Changement[]> {
  const stock = await stockDe(tx, produitId, boutiqueId);
  return stock ? [{ seq: 0, entite: 'stock', id: stock.id, donnees: versStock(stock) }] : [];
}

/** Ajustement de la quantité d'un accessoire, avec motif (inventaire, casse…). */
export const stockAjuster: Gestionnaire<'STOCK_AJUSTER'> = {
  type: 'STOCK_AJUSTER',
  roles: GESTION,

  async appliquer({ tx, utilisateur, operation, journal, audit }, contenu) {
    const produit = await tx.produit.findFirst({
      where: { id: contenu.produitId, commerceId: utilisateur.commerceId },
      select: { type: true },
    });
    if (!produit) return { ok: false, statut: 'REJETEE', motif: 'Produit inconnu.' };
    if (produit.type !== 'ACCESSOIRE') {
      return {
        ok: false,
        statut: 'REJETEE',
        motif: 'Un téléphone se gère par son IMEI, pas par quantité.',
      };
    }
    const existant = await stockDe(tx, contenu.produitId, operation.boutiqueId);
    const controle = controlerAjustementStock(existant?.quantite ?? 0, contenu.delta);
    if (!controle.ok) return controle;

    const stock = existant
      ? await tx.stock.update({
          where: { id: existant.id },
          data: { quantite: { increment: contenu.delta } },
        })
      : await tx.stock.create({
          data: {
            produitId: contenu.produitId,
            boutiqueId: operation.boutiqueId,
            quantite: contenu.delta,
          },
        });
    await tx.mouvementStock.create({
      data: {
        commerceId: utilisateur.commerceId,
        boutiqueId: operation.boutiqueId,
        produitId: contenu.produitId,
        type: 'AJUSTEMENT',
        quantite: contenu.delta,
        motif: contenu.motif,
        referenceType: 'OperationSync',
        referenceId: operation.id,
        utilisateurId: utilisateur.id,
      },
    });
    await audit.journaliser(
      {
        commerceId: utilisateur.commerceId,
        boutiqueId: operation.boutiqueId,
        utilisateurId: utilisateur.id,
        appareilId: utilisateur.appareilId,
        action: ACTIONS_AUDIT.AJUSTEMENT_STOCK,
        entite: 'Stock',
        entiteId: stock.id,
        details: { delta: contenu.delta, motif: contenu.motif, quantite: stock.quantite },
      },
      tx,
    );
    await journal.ecrire(tx, utilisateur.commerceId, [
      { entite: 'stock', id: stock.id, boutiqueId: stock.boutiqueId, donnees: versStock(stock) },
    ]);
    return { ok: true };
  },

  corrections: (tx, operation, contenu) =>
    correctionStock(tx, contenu.produitId, operation.boutiqueId),
};

/** Sortie d'un téléphone du stock (perte, casse, vol) : il ne peut plus être vendu. */
export const articleSortir: Gestionnaire<'ARTICLE_SORTIR'> = {
  type: 'ARTICLE_SORTIR',
  roles: GESTION,

  async appliquer({ tx, utilisateur, operation, journal, audit }, contenu) {
    const article = await tx.article.findFirst({
      where: { id: contenu.articleId, commerceId: utilisateur.commerceId },
    });
    const controle = controlerSortieArticle(article, operation.boutiqueId);
    if (!controle.ok || !article) return controle;

    const sorti = await tx.article.update({
      where: { id: article.id },
      data: { statut: 'REBUT' },
    });
    const existant = await stockDe(tx, article.produitId, article.boutiqueId);
    const stock = existant
      ? await tx.stock.update({
          where: { id: existant.id },
          data: { quantite: Math.max(0, existant.quantite - 1) },
        })
      : null;
    await tx.mouvementStock.create({
      data: {
        commerceId: utilisateur.commerceId,
        boutiqueId: article.boutiqueId,
        produitId: article.produitId,
        articleId: article.id,
        type: 'REBUT',
        quantite: -1,
        motif: contenu.motif,
        referenceType: 'OperationSync',
        referenceId: operation.id,
        utilisateurId: utilisateur.id,
      },
    });
    await audit.journaliser(
      {
        commerceId: utilisateur.commerceId,
        boutiqueId: article.boutiqueId,
        utilisateurId: utilisateur.id,
        appareilId: utilisateur.appareilId,
        action: ACTIONS_AUDIT.SORTIE_ARTICLE,
        entite: 'Article',
        entiteId: article.id,
        details: { imei: article.imei, motif: contenu.motif },
      },
      tx,
    );
    await journal.ecrire(tx, utilisateur.commerceId, [
      {
        entite: 'article',
        id: sorti.id,
        boutiqueId: sorti.boutiqueId,
        donnees: versArticle(sorti),
      },
      ...(stock
        ? [
            {
              entite: 'stock' as const,
              id: stock.id,
              boutiqueId: stock.boutiqueId,
              donnees: versStock(stock),
            },
          ]
        : []),
    ]);
    return { ok: true };
  },

  async corrections(tx, _operation, contenu) {
    const article = await tx.article.findUnique({ where: { id: contenu.articleId } });
    if (!article) return [];
    return [
      { seq: 0, entite: 'article', id: article.id, donnees: versArticle(article) },
      ...(await correctionStock(tx, article.produitId, article.boutiqueId)),
    ];
  },
};
