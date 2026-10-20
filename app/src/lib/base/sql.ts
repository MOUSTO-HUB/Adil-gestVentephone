/**
 * Accès SQL minimal de la base locale. L'application l'implémente avec
 * expo-sqlite (ouvrir.ts), les tests avec node:sqlite (sql-node.test-utils.ts) :
 * la logique de synchronisation se teste sans téléphone.
 */
export type ValeurSql = string | number | null;

export interface BaseSql {
  executer(sql: string, params?: ValeurSql[]): Promise<void>;
  tous<T>(sql: string, params?: ValeurSql[]): Promise<T[]>;
  premier<T>(sql: string, params?: ValeurSql[]): Promise<T | null>;
  /** Tout ou rien : une erreur annule toutes les écritures de `travail`. */
  transaction(travail: (tx: BaseSql) => Promise<void>): Promise<void>;
}
