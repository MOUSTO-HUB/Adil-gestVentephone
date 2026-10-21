import type { Changement } from '@gestvente/commun';
import { Role } from '../../generated/prisma/enums.js';
import { annulerVente, enregistrerVente } from '../../ventes/ventes.ecritures.js';
import type { Tx } from '../journal.service.js';
import {
  versArticle,
  versClient,
  versLigneVente,
  versPaiementVente,
  versStock,
  versVente,
} from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';
import { etatTroc } from './trocs.operations.js';

/** État du serveur après refus : la vente (ou son effacement), téléphones et stocks touchés. */
export async function etatVente(
  tx: Tx,
  boutiqueId: string,
  venteId: string,
  lignes: { id: string; produitId: string; articleId: string | null }[],
  paiementIds: string[],
): Promise<Changement[]> {
  const vente = await tx.vente.findUnique({
    where: { id: venteId },
    include: { lignes: true, paiements: true },
  });
  const articles = await tx.article.findMany({
    where: { id: { in: lignes.flatMap((l) => (l.articleId ? [l.articleId] : [])) } },
  });
  const stocks = await tx.stock.findMany({
    where: { boutiqueId, produitId: { in: lignes.map((l) => l.produitId) } },
  });
  return [
    { seq: 0, entite: 'vente', id: venteId, donnees: vente && versVente(vente) },
    ...lignes.map((l) => {
      const serveur = vente?.lignes.find((x) => x.id === l.id);
      return {
        seq: 0,
        entite: 'ligneVente' as const,
        id: l.id,
        donnees: serveur ? versLigneVente(serveur) : null,
      };
    }),
    ...paiementIds.map((id) => {
      const serveur = vente?.paiements.find((p) => p.id === id);
      return {
        seq: 0,
        entite: 'paiementVente' as const,
        id,
        donnees: serveur ? versPaiementVente(serveur) : null,
      };
    }),
    ...articles.map((a) => ({
      seq: 0,
      entite: 'article' as const,
      id: a.id,
      donnees: versArticle(a),
    })),
    ...stocks.map((s) => ({ seq: 0, entite: 'stock' as const, id: s.id, donnees: versStock(s) })),
  ];
}

/** Tout le personnel vend ; les remises au-delà du plafond exigent un gérant. */
export const venteEnregistrer: Gestionnaire<'VENTE_ENREGISTRER'> = {
  type: 'VENTE_ENREGISTRER',
  roles: [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR],
  appliquer: (ctx, contenu) => enregistrerVente(ctx, contenu),
  async corrections(tx, operation, contenu) {
    const corrections = await etatVente(
      tx,
      operation.boutiqueId,
      contenu.id,
      contenu.lignes,
      contenu.paiements.map((p) => p.id),
    );
    // Avoir payé : le solde du client reprend sa valeur sur le serveur.
    const client =
      contenu.clientId && contenu.paiements.some((p) => p.moyen === 'AVOIR')
        ? await tx.client.findUnique({ where: { id: contenu.clientId } })
        : null;
    if (client) {
      corrections.push({ seq: 0, entite: 'client', id: client.id, donnees: versClient(client) });
    }
    // Troc refusé : l'appareil repris sort du stock de l'appareil.
    if (contenu.troc) corrections.push(...(await etatTroc(tx, operation.boutiqueId, contenu.troc)));
    return corrections;
  },
};

export const venteAnnuler: Gestionnaire<'VENTE_ANNULER'> = {
  type: 'VENTE_ANNULER',
  roles: [Role.PROPRIETAIRE, Role.GERANT],
  appliquer: (ctx, contenu) => annulerVente(ctx, contenu),
  async corrections(tx, operation, contenu) {
    const vente = await tx.vente.findUnique({
      where: { id: contenu.venteId },
      include: { lignes: true, paiements: true },
    });
    if (!vente) return [];
    return etatVente(
      tx,
      operation.boutiqueId,
      vente.id,
      vente.lignes,
      vente.paiements.map((p) => p.id),
    );
  },
};
