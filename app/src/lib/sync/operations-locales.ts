import {
  type ContenuOperation,
  controlerAjustementStock,
  controlerSortieArticle,
  erreurContenu,
  type Operation,
  type StatutArticle,
  type TypeOperation,
} from '@gestvente/commun';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';
import * as achats from './operations-achats';
import * as catalogue from './operations-catalogue';
import * as clients from './operations-clients';
import * as ventes from './operations-ventes';

export { ErreurOperation };

type AppliquerLocal<T extends TypeOperation> = (
  tx: BaseSql,
  boutiqueId: string,
  contenu: ContenuOperation<T>,
  idProvisoire: () => string,
  contexte: { utilisateurId: string },
) => Promise<void>;

/**
 * Effet de chaque type d'opération sur la base locale, appliqué aussitôt (même
 * hors ligne). Le serveur refait le même contrôle et fait foi.
 */
const APPLIQUER: { [T in TypeOperation]: AppliquerLocal<T> } = {
  async STOCK_AJUSTER(tx, boutiqueId, contenu, idProvisoire) {
    const stock = await tx.premier<{ id: string; quantite: number }>(
      'SELECT id, quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
      [contenu.produitId, boutiqueId],
    );
    const controle = controlerAjustementStock(stock?.quantite ?? 0, contenu.delta);
    if (!controle.ok) throw new ErreurOperation(controle.motif);
    if (stock) {
      await tx.executer('UPDATE stock SET quantite = quantite + ? WHERE id = ?', [
        contenu.delta,
        stock.id,
      ]);
    } else {
      // Ligne provisoire : remplacée par celle du serveur à la synchronisation.
      await tx.executer(
        'INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES (?, ?, ?, ?, 0)',
        [idProvisoire(), contenu.produitId, boutiqueId, contenu.delta],
      );
    }
  },

  async ARTICLE_SORTIR(tx, boutiqueId, contenu) {
    const article = await tx.premier<{
      produitId: string;
      boutiqueId: string;
      statut: StatutArticle;
    }>('SELECT produitId, boutiqueId, statut FROM article WHERE id = ?', [contenu.articleId]);
    const controle = controlerSortieArticle(article, boutiqueId);
    if (!controle.ok || !article) {
      throw new ErreurOperation(controle.ok ? 'Téléphone inconnu.' : controle.motif);
    }
    await tx.executer("UPDATE article SET statut = 'REBUT' WHERE id = ?", [contenu.articleId]);
    await tx.executer(
      'UPDATE stock SET quantite = MAX(0, quantite - 1) WHERE produitId = ? AND boutiqueId = ?',
      [article.produitId, article.boutiqueId],
    );
  },

  MARQUE_ENREGISTRER: (tx, _boutiqueId, contenu) => catalogue.marqueEnregistrer(tx, contenu),
  MODELE_ENREGISTRER: (tx, _boutiqueId, contenu) => catalogue.modeleEnregistrer(tx, contenu),
  CATEGORIE_ENREGISTRER: (tx, _boutiqueId, contenu) => catalogue.categorieEnregistrer(tx, contenu),
  PRODUIT_ENREGISTRER: (tx, _boutiqueId, contenu) => catalogue.produitEnregistrer(tx, contenu),
  PRIX_BOUTIQUE_ENREGISTRER: (tx, boutiqueId, contenu) =>
    catalogue.prixBoutiqueEnregistrer(tx, boutiqueId, contenu),
  CLIENT_ENREGISTRER: (tx, _boutiqueId, contenu) => clients.clientEnregistrer(tx, contenu),
  FOURNISSEUR_ENREGISTRER: (tx, _boutiqueId, contenu) =>
    clients.fournisseurEnregistrer(tx, contenu),
  ACHAT_ENREGISTRER: (tx, boutiqueId, contenu) => achats.achatEnregistrer(tx, boutiqueId, contenu),
  ACHAT_RECEVOIR: (tx, boutiqueId, contenu, id) =>
    achats.achatRecevoir(tx, boutiqueId, contenu, id),
  ACHAT_PAYER: (tx, boutiqueId, contenu) => achats.achatPayer(tx, boutiqueId, contenu),
  ACHAT_ANNULER: (tx, boutiqueId, contenu) => achats.achatAnnuler(tx, boutiqueId, contenu),
  STOCK_SEUIL: (tx, boutiqueId, contenu, id) => achats.stockSeuil(tx, boutiqueId, contenu, id),
  INVENTAIRE_VALIDER: (tx, boutiqueId, contenu, id) =>
    achats.inventaireValider(tx, boutiqueId, contenu, id),
  VENTE_ENREGISTRER: (tx, boutiqueId, contenu, _id, contexte) =>
    ventes.venteEnregistrer(tx, boutiqueId, contenu, contexte.utilisateurId),
  VENTE_ANNULER: (tx, boutiqueId, contenu) => ventes.venteAnnuler(tx, boutiqueId, contenu),
};

export interface NouvelleOperation<T extends TypeOperation> {
  type: T;
  boutiqueId: string;
  contenu: ContenuOperation<T>;
  /** Auteur (vendeur d'une vente) ; le serveur retient l'utilisateur connecté. */
  utilisateurId?: string;
}

/**
 * Enregistre une opération : effet local et ajout à la file sortante dans la
 * même transaction (tout ou rien). La synchronisation l'enverra au serveur.
 */
export async function enregistrerOperation<T extends TypeOperation>(
  base: BaseSql,
  nouvelle: NouvelleOperation<T>,
  creerId: () => string,
  maintenant: () => Date = () => new Date(),
): Promise<Operation> {
  const erreur = erreurContenu(nouvelle.type, nouvelle.contenu);
  if (erreur) throw new ErreurOperation(erreur);
  const operation: Operation = {
    id: creerId(),
    type: nouvelle.type,
    boutiqueId: nouvelle.boutiqueId,
    faiteLe: maintenant().toISOString(),
    contenu: nouvelle.contenu,
  };
  await base.transaction(async (tx) => {
    await (APPLIQUER[nouvelle.type] as AppliquerLocal<T>)(
      tx,
      nouvelle.boutiqueId,
      nouvelle.contenu,
      () => `provisoire:${creerId()}`,
      { utilisateurId: nouvelle.utilisateurId ?? '' },
    );
    await tx.executer(
      'INSERT INTO operation (id, type, boutiqueId, faiteLe, contenu) VALUES (?, ?, ?, ?, ?)',
      [
        operation.id,
        operation.type,
        operation.boutiqueId,
        operation.faiteLe,
        JSON.stringify(operation.contenu),
      ],
    );
  });
  return operation;
}
