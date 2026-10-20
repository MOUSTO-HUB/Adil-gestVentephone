import {
  type ClientSync,
  type FournisseurSync,
  motsRecherche,
  normaliserRecherche,
} from '@gestvente/commun';
import type { BaseSql, ValeurSql } from './base/sql';

export const LIMITE_CLIENTS = 100;

/** Conditions « chaque mot dans le texte de recherche » ; les chiffres cherchent aussi le téléphone. */
function filtreMots(terme: string, colonne: string): { sql: string; params: ValeurSql[] } {
  const mots = motsRecherche(terme);
  if (!mots.length) return { sql: '', params: [] };
  return {
    sql: `AND ${mots.map(() => `${colonne} LIKE ?`).join(' AND ')}`,
    params: mots.map((m) => `%${m}%`),
  };
}

/** Clients par nom ou téléphone (hors ligne). */
export async function rechercherClients(
  base: BaseSql,
  terme: string,
  archives = false,
): Promise<ClientSync[]> {
  const filtre = filtreMots(terme, 'recherche');
  return base.tous<ClientSync>(
    `SELECT * FROM client WHERE 1 = 1 ${archives ? '' : 'AND archive = 0'} ${filtre.sql}
      ORDER BY recherche LIMIT ${LIMITE_CLIENTS}`,
    filtre.params,
  );
}

/** Autres clients qui ont déjà ce numéro (détection des doublons à la saisie). */
export function clientsAvecTelephone(base: BaseSql, telephone: string, sauf: string | null) {
  return base.tous<{ id: string; nom: string }>(
    'SELECT id, nom FROM client WHERE telephone = ? AND id <> ? ORDER BY nom',
    [telephone, sauf ?? ''],
  );
}

/** Fournisseurs par nom, sans tenir compte des accents (liste courte : filtrée ici). */
export async function rechercherFournisseurs(
  base: BaseSql,
  terme: string,
): Promise<FournisseurSync[]> {
  const mots = motsRecherche(terme);
  const tous = await base.tous<FournisseurSync>('SELECT * FROM fournisseur ORDER BY archive, nom');
  return tous
    .filter((f) => {
      const nom = normaliserRecherche(f.nom);
      return mots.every((m) => nom.includes(m));
    })
    .slice(0, LIMITE_CLIENTS);
}
