import type { Changement } from '@gestvente/commun';
import { Role } from '../../generated/prisma/enums.js';
import {
  annulerTransfert,
  demanderTransfert,
  envoyerTransfert,
  recevoirTransfert,
} from '../../transferts/transferts.ecritures.js';
import type { Tx } from '../journal.service.js';
import { versArticle, versLigneTransfert, versStock, versTransfert } from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

const GESTION = [Role.PROPRIETAIRE, Role.GERANT];

/** État du serveur pour un transfert refusé : transfert, lignes, téléphones et stocks de la boutique. */
async function etatTransfert(
  tx: Tx,
  boutiqueId: string,
  transfertId: string,
  lignes: { id: string; produitId: string; articleId?: string | null }[] = [],
): Promise<Changement[]> {
  const t = await tx.transfert.findUnique({
    where: { id: transfertId },
    include: { lignes: { include: { article: { select: { imei: true } } } } },
  });
  const serveur = t?.lignes ?? [];
  const toutes = [...serveur, ...lignes];
  const articles = await tx.article.findMany({
    where: { id: { in: toutes.flatMap((l) => (l.articleId ? [l.articleId] : [])) } },
  });
  const stocks = await tx.stock.findMany({
    where: { boutiqueId, produitId: { in: toutes.map((l) => l.produitId) } },
  });
  return [
    { seq: 0, entite: 'transfert', id: transfertId, donnees: t && versTransfert(t) },
    ...serveur.map((l) => ({
      seq: 0,
      entite: 'ligneTransfert' as const,
      id: l.id,
      donnees: versLigneTransfert(l),
    })),
    ...lignes
      .filter((l) => !serveur.some((s) => s.id === l.id))
      .map((l) => ({ seq: 0, entite: 'ligneTransfert' as const, id: l.id, donnees: null })),
    // Un téléphone d'une autre boutique sort de l'appareil.
    ...articles.map((a) => ({
      seq: 0,
      entite: 'article' as const,
      id: a.id,
      donnees: a.boutiqueId === boutiqueId ? versArticle(a) : null,
    })),
    ...stocks.map((s) => ({ seq: 0, entite: 'stock' as const, id: s.id, donnees: versStock(s) })),
  ];
}

export const transfertDemander: Gestionnaire<'TRANSFERT_DEMANDER'> = {
  type: 'TRANSFERT_DEMANDER',
  roles: GESTION,
  appliquer: (ctx, contenu) => demanderTransfert(ctx, contenu),
  corrections: (tx, operation, contenu) =>
    etatTransfert(tx, operation.boutiqueId, contenu.id, contenu.lignes),
};

export const transfertEnvoyer: Gestionnaire<'TRANSFERT_ENVOYER'> = {
  type: 'TRANSFERT_ENVOYER',
  roles: GESTION,
  appliquer: (ctx, contenu) => envoyerTransfert(ctx, contenu),
  corrections: (tx, operation, contenu) =>
    etatTransfert(tx, operation.boutiqueId, contenu.id, contenu.lignes),
};

/** Tout le personnel de la boutique d'arrivée réceptionne. */
export const transfertRecevoir: Gestionnaire<'TRANSFERT_RECEVOIR'> = {
  type: 'TRANSFERT_RECEVOIR',
  roles: [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR],
  appliquer: (ctx, contenu) => recevoirTransfert(ctx, contenu),
  corrections: (tx, operation, contenu) =>
    etatTransfert(tx, operation.boutiqueId, contenu.transfertId),
};

export const transfertAnnuler: Gestionnaire<'TRANSFERT_ANNULER'> = {
  type: 'TRANSFERT_ANNULER',
  roles: GESTION,
  appliquer: (ctx, contenu) => annulerTransfert(ctx, contenu),
  corrections: (tx, operation, contenu) =>
    etatTransfert(tx, operation.boutiqueId, contenu.transfertId),
};
