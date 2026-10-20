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

/** Refus immédiat sur l'appareil (contenu invalide, règle déjà enfreinte localement). */
export class ErreurOperation extends Error {}

type AppliquerLocal<T extends TypeOperation> = (
  tx: BaseSql,
  boutiqueId: string,
  contenu: ContenuOperation<T>,
  idProvisoire: () => string,
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
};

export interface NouvelleOperation<T extends TypeOperation> {
  type: T;
  boutiqueId: string;
  contenu: ContenuOperation<T>;
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
