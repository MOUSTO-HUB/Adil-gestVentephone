import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { CLES, effacer, ecrire, lire } from '../stockage';
import { completerRecherche } from './depot';
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

/**
 * Fermeture et effacement se font en arrière-plan à la déconnexion : une reconnexion
 * rapide attend qu'ils soient finis, sinon la nouvelle base serait effacée sous ses pieds.
 */
let fermetureEnCours: Promise<void> = Promise.resolve();
let effacementEnCours: Promise<void> = Promise.resolve();

export interface BaseOuverte {
  base: BaseSql;
  fermer: () => Promise<void>;
}

/**
 * Ouvre la base. Sur le site, juste après un rechargement ou une mise à jour, l'ancienne
 * page peut encore tenir le fichier de la base quelques instants : on réessaie (6 fois,
 * pendant une quinzaine de secondes) avant d'afficher une erreur.
 */
async function ouvrirAvecReprise(essais = 6): Promise<SQLite.SQLiteDatabase> {
  for (let essai = 1; ; essai++) {
    let db: SQLite.SQLiteDatabase | null = null;
    try {
      db = await SQLite.openDatabaseAsync(NOM_BASE);
      if (Platform.OS !== 'web') {
        await db.execAsync(`PRAGMA key = '${await cleBase()}'`);
      }
      await db.execAsync('PRAGMA foreign_keys = OFF');
      return db;
    } catch (e) {
      await db?.closeAsync().catch(() => undefined);
      if (essai >= essais) throw e;
      await new Promise((ok) => setTimeout(ok, 1000 * essai));
    }
  }
}

/**
 * Ouvre la base locale et applique les migrations. Sur téléphone, elle est
 * chiffrée (SQLCipher, version de développement ou de production : pas Expo Go).
 */
export async function ouvrirBase(): Promise<BaseOuverte> {
  await effacementEnCours;
  const db = await ouvrirAvecReprise();
  const base = adapter(db);
  await migrer(base);
  await completerRecherche(base);
  return {
    base,
    fermer: () => {
      fermetureEnCours = db.closeAsync().catch(() => undefined);
      return fermetureEnCours;
    },
  };
}

/** Efface la base locale (déconnexion) : rien ne reste sur l'appareil. */
export function effacerBase(ouverte: BaseOuverte | null): Promise<void> {
  effacementEnCours = (async () => {
    await effacementEnCours;
    await ouverte?.fermer().catch(() => undefined);
    await fermetureEnCours;
    await SQLite.deleteDatabaseAsync(NOM_BASE).catch(() => undefined);
    await effacer(CLES.cleBase);
  })();
  return effacementEnCours;
}
