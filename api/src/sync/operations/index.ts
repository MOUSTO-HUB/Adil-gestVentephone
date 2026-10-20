import type { TypeOperation } from '@gestvente/commun';
import type { Gestionnaire } from './gestionnaire.js';
import { articleSortir, stockAjuster } from './stock.operations.js';

/** Un gestionnaire par type d'opération (chaque fonctionnalité ajoute les siens). */
export const GESTIONNAIRES: { [T in TypeOperation]: Gestionnaire<T> } = {
  STOCK_AJUSTER: stockAjuster,
  ARTICLE_SORTIR: articleSortir,
};
