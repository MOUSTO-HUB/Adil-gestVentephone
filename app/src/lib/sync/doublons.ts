import { normaliserRecherche } from '@gestvente/commun';
import type { BaseSql } from '../base/sql';

/**
 * Nom déjà pris dans une table (sans tenir compte de la casse ni des accents ;
 * SQLite ne sait mettre en minuscules que les lettres sans accent).
 */
export async function nomDejaPris(
  tx: BaseSql,
  table: 'marque' | 'modele' | 'categorie' | 'fournisseur',
  id: string,
  nom: string,
  filtre: { colonne: string; valeur: string } | null = null,
): Promise<string | null> {
  const lignes = await tx.tous<{ nom: string }>(
    `SELECT nom FROM ${table} WHERE id <> ?${filtre ? ` AND ${filtre.colonne} = ?` : ''}`,
    filtre ? [id, filtre.valeur] : [id],
  );
  const cherche = normaliserRecherche(nom);
  return lignes.find((l) => normaliserRecherche(l.nom) === cherche)?.nom ?? null;
}
