import type { Changement } from '@gestvente/commun';
import { Role } from '../../generated/prisma/enums.js';
import { enregistrerGrille, remettreEnVente, signalerImei } from '../../trocs/troc.ecritures.js';
import type { Tx } from '../journal.service.js';
import {
  versArticle,
  versGrilleReprise,
  versImeiSignale,
  versStock,
  versTroc,
} from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

const GESTION = [Role.PROPRIETAIRE, Role.GERANT];

/** État du serveur pour le troc refusé d'une vente : troc, article provisoire, stock. */
export async function etatTroc(
  tx: Tx,
  boutiqueId: string,
  troc: { id: string; articleId: string; produitId: string },
): Promise<Changement[]> {
  const serveur = await tx.troc.findUnique({ where: { id: troc.id } });
  const article = await tx.article.findUnique({ where: { id: troc.articleId } });
  const stock = await tx.stock.findUnique({
    where: { produitId_boutiqueId: { produitId: troc.produitId, boutiqueId } },
  });
  return [
    { seq: 0, entite: 'troc', id: troc.id, donnees: serveur && versTroc(serveur) },
    { seq: 0, entite: 'article', id: troc.articleId, donnees: article && versArticle(article) },
    ...(stock
      ? [{ seq: 0, entite: 'stock' as const, id: stock.id, donnees: versStock(stock) }]
      : []),
  ];
}

/** La grille de reprise est fixée par le propriétaire. */
export const grilleRepriseEnregistrer: Gestionnaire<'GRILLE_REPRISE_ENREGISTRER'> = {
  type: 'GRILLE_REPRISE_ENREGISTRER',
  roles: [Role.PROPRIETAIRE],
  appliquer: (ctx, contenu) => enregistrerGrille(ctx, contenu),
  async corrections(tx, _operation, contenu) {
    const capacite = contenu.capacite?.trim() || null;
    const serveur = await tx.grilleReprise.findMany({
      where: { modeleId: contenu.modeleId, capacite },
    });
    return [
      ...contenu.lignes
        .filter((l) => !serveur.some((g) => g.id === l.id))
        .map((l) => ({ seq: 0, entite: 'grilleReprise' as const, id: l.id, donnees: null })),
      ...serveur.map((g) => ({
        seq: 0,
        entite: 'grilleReprise' as const,
        id: g.id,
        donnees: versGrilleReprise(g),
      })),
    ];
  },
};

export const imeiSignaler: Gestionnaire<'IMEI_SIGNALER'> = {
  type: 'IMEI_SIGNALER',
  roles: GESTION,
  appliquer: (ctx, contenu) => signalerImei(ctx, contenu),
  async corrections(tx, _operation, contenu) {
    const serveur = await tx.imeiSignale.findUnique({ where: { id: contenu.id } });
    return [
      {
        seq: 0,
        entite: 'imeiSignale',
        id: contenu.id,
        donnees: serveur && versImeiSignale(serveur),
      },
    ];
  },
};

export const articleRemettreEnVente: Gestionnaire<'ARTICLE_REMETTRE_EN_VENTE'> = {
  type: 'ARTICLE_REMETTRE_EN_VENTE',
  roles: GESTION,
  appliquer: (ctx, contenu) => remettreEnVente(ctx, contenu),
  async corrections(tx, _operation, contenu) {
    const article = await tx.article.findUnique({ where: { id: contenu.articleId } });
    return [
      {
        seq: 0,
        entite: 'article',
        id: contenu.articleId,
        donnees: article && versArticle(article),
      },
    ];
  },
};
