import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { CLES, effacer, ecrire, lire } from '../stockage';
import { migrer } from './migrations';
import type { BaseSql, ValeurSql } from './sql';

const NOM_BASE = 'gestvente.db';

function adapter(db: SQLite.SQLiteDatabase): BaseSql {
  const base: BaseSql = {
    async executer(sql, params: ValeurSql[] = []) {
      if (params.length === 0) await db.execAsync(sql);
      else await db.runAsync(sql, params);
    },
    tous: <T>(sql: string, params: ValeurSql[] = []) => db.getAllAsync<T>(sql, params),
    premier: <T>(sql: string, params: ValeurSql[] = []) => db.getFirstAsync<T>(sql, params),
    async transaction(travail) {
      // Sur le web, les transactions exclusives n'existent pas : le moteur ne lance
      // qu'une synchronisation à la fois, ce qui suffit à éviter les mélanges.
      if (Platform.OS === 'web') await db.withTransactionAsync(() => travail(base));
      else await db.withExclusiveTransactionAsync((txn) => travail(adapter(txn)));
    },
  };
  return base;
}

/** Clé de chiffrement de la base (SQLCipher), gardée dans le coffre de l'appareil. */
async function cleBase(): Promise<string> {
  const existante = await lire<string>(CLES.cleBase);
  if (existante) return existante;
  const cle = [...Crypto.getRandomBytes(32)].map((o) => o.toString(16).padStart(2, '0')).join('');
  await ecrire(CLES.cleBase, cle);
  return cle;
}

export interface BaseOuverte {
  base: BaseSql;
  fermer: () => Promise<void>;
}

/**
 * Ouvre la base locale et applique les migrations. Sur téléphone, elle est
 * chiffrée (SQLCipher, version de développement ou de production : pas Expo Go).
 */
export async function ouvrirBase(): Promise<BaseOuverte> {
  const db = await SQLite.openDatabaseAsync(NOM_BASE);
  if (Platform.OS !== 'web') {
    await db.execAsync(`PRAGMA key = '${await cleBase()}'`);
  }
  await db.execAsync('PRAGMA foreign_keys = OFF');
  const base = adapter(db);
  await migrer(base);
  return { base, fermer: () => db.closeAsync() };
}

/** Efface la base locale (déconnexion) : rien ne reste sur l'appareil. */
export async function effacerBase(ouverte: BaseOuverte | null): Promise<void> {
  await ouverte?.fermer().catch(() => undefined);
  await SQLite.deleteDatabaseAsync(NOM_BASE).catch(() => undefined);
  await effacer(CLES.cleBase);
}
