import type { Changement } from '@gestvente/commun';
import {
  annulerAchat,
  definirSeuil,
  enregistrerAchat,
  payerAchat,
  recevoirAchat,
  validerInventaire,
} from '../../achats/achats.ecritures.js';
import { detteFournisseur } from '../../clients/clients.ecritures.js';
import { Role } from '../../generated/prisma/enums.js';
import type { Tx } from '../journal.service.js';
import {
  versAchat,
  versArticle,
  versFournisseur,
  versLigneAchat,
  versStock,
} from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

const GESTION = [Role.PROPRIETAIRE, Role.GERANT];

/** État du serveur pour un bon : le bon, ses lignes, la dette du fournisseur. */
async function etatAchat(
  tx: Tx,
  achatId: string,
  lignesAppareil: string[] = [],
): Promise<Changement[]> {
  const achat = await tx.achat.findUnique({
    where: { id: achatId },
    include: { lignes: true, fournisseur: true },
  });
  if (!achat) {
    // Bon refusé à sa création : l'appareil efface sa version locale.
    return [
      { seq: 0, entite: 'achat', id: achatId, donnees: null },
      ...lignesAppareil.map((id) => ({ seq: 0, entite: 'ligneAchat' as const, id, donnees: null })),
    ];
  }
  return [
    { seq: 0, entite: 'achat', id: achat.id, donnees: versAchat(achat) },
    ...achat.lignes.map((l) => ({
      seq: 0,
      entite: 'ligneAchat' as const,
      id: l.id,
      donnees: versLigneAchat(l),
    })),
    ...lignesAppareil
      .filter((id) => !achat.lignes.some((l) => l.id === id))
      .map((id) => ({ seq: 0, entite: 'ligneAchat' as const, id, donnees: null })),
    {
      seq: 0,
      entite: 'fournisseur',
      id: achat.fournisseurId,
      donnees: versFournisseur(achat.fournisseur, await detteFournisseur(tx, achat.fournisseurId)),
    },
  ];
}

/** Stocks des produits d'une boutique (corrections de quantités). */
async function etatStocks(tx: Tx, boutiqueId: string, produitIds: string[]): Promise<Changement[]> {
  const stocks = await tx.stock.findMany({ where: { boutiqueId, produitId: { in: produitIds } } });
  return stocks.map((s) => ({ seq: 0, entite: 'stock' as const, id: s.id, donnees: versStock(s) }));
}

export const achatEnregistrer: Gestionnaire<'ACHAT_ENREGISTRER'> = {
  type: 'ACHAT_ENREGISTRER',
  roles: GESTION,
  appliquer: (ctx, contenu) => enregistrerAchat(ctx, ctx.operation.boutiqueId, contenu),
  corrections: (tx, _op, contenu) =>
    etatAchat(
      tx,
      contenu.id,
      contenu.lignes.map((l) => l.id),
    ),
};

export const achatRecevoir: Gestionnaire<'ACHAT_RECEVOIR'> = {
  type: 'ACHAT_RECEVOIR',
  roles: GESTION,
  appliquer: (ctx, contenu) => recevoirAchat(ctx, ctx.operation.boutiqueId, contenu),
  async corrections(tx, operation, contenu) {
    const lignes = await tx.ligneAchat.findMany({ where: { achatId: contenu.achatId } });
    // Téléphones créés sur l'appareil mais refusés : effacés, sauf s'ils existent vraiment.
    const ids = contenu.lignes.flatMap((r) => r.articles?.map((a) => a.id) ?? []);
    const existants = await tx.article.findMany({ where: { id: { in: ids } } });
    return [
      ...(await etatAchat(tx, contenu.achatId)),
      ...(await etatStocks(
        tx,
        operation.boutiqueId,
        lignes.map((l) => l.produitId),
      )),
      ...ids.map((id) => {
        const article = existants.find((a) => a.id === id);
        return {
          seq: 0,
          entite: 'article' as const,
          id,
          donnees: article ? versArticle(article) : null,
        };
      }),
    ];
  },
};

export const achatPayer: Gestionnaire<'ACHAT_PAYER'> = {
  type: 'ACHAT_PAYER',
  roles: GESTION,
  appliquer: (ctx, contenu) => payerAchat(ctx, ctx.operation.boutiqueId, contenu),
  corrections: (tx, _op, contenu) => etatAchat(tx, contenu.achatId),
};

export const achatAnnuler: Gestionnaire<'ACHAT_ANNULER'> = {
  type: 'ACHAT_ANNULER',
  roles: GESTION,
  appliquer: (ctx, contenu) => annulerAchat(ctx, ctx.operation.boutiqueId, contenu),
  corrections: (tx, _op, contenu) => etatAchat(tx, contenu.achatId),
};

export const stockSeuil: Gestionnaire<'STOCK_SEUIL'> = {
  type: 'STOCK_SEUIL',
  roles: GESTION,
  appliquer: (ctx, contenu) => definirSeuil(ctx, ctx.operation.boutiqueId, contenu),
  corrections: (tx, operation, contenu) =>
    etatStocks(tx, operation.boutiqueId, [contenu.produitId]),
};

export const inventaireValider: Gestionnaire<'INVENTAIRE_VALIDER'> = {
  type: 'INVENTAIRE_VALIDER',
  roles: GESTION,
  appliquer: (ctx, contenu) => validerInventaire(ctx, ctx.operation.boutiqueId, contenu),
  async corrections(tx, operation, contenu) {
    const produitIds = contenu.lignes.map((l) => l.produitId);
    const articles = await tx.article.findMany({
      where: { boutiqueId: operation.boutiqueId, produitId: { in: produitIds } },
    });
    return [
      ...(await etatStocks(tx, operation.boutiqueId, produitIds)),
      ...articles.map((a) => ({
        seq: 0,
        entite: 'article' as const,
        id: a.id,
        donnees: versArticle(a),
      })),
    ];
  },
};
