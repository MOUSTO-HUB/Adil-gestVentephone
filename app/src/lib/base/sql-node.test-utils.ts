import { DatabaseSync } from 'node:sqlite';
import type { BaseSql, ValeurSql } from './sql';

/** Base SQLite en mémoire (node:sqlite) avec la même interface que l'application. */
export function baseEnMemoire(): BaseSql {
  const db = new DatabaseSync(':memory:');
  let profondeur = 0;
  const base: BaseSql = {
    async executer(sql: string, params: ValeurSql[] = []) {
      if (params.length === 0) db.exec(sql);
      else db.prepare(sql).run(...params);
    },
    async tous<T>(sql: string, params: ValeurSql[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async premier<T>(sql: string, params: ValeurSql[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async transaction(travail) {
      // Transactions imbriquées : seule la plus externe valide ou annule.
      if (profondeur > 0) return travail(base);
      profondeur++;
      db.exec('BEGIN');
      try {
        await travail(base);
        db.exec('COMMIT');
      } catch (erreur) {
        db.exec('ROLLBACK');
        throw erreur;
      } finally {
        profondeur--;
      }
    },
  };
  return base;
}
