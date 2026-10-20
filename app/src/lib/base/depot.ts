import {
  texteRecherche,
  texteRechercheClient,
  type Changement,
  type DonneesEntites,
  type EntiteSync,
  ENTITES_SYNC,
  type Instantane,
} from '@gestvente/commun';
import type { BaseSql, ValeurSql } from './sql';

/** Colonnes de chaque table locale, dans l'ordre (mêmes noms que les champs synchronisés). */
const COLONNES: { [E in EntiteSync]: (keyof DonneesEntites[E] & string)[] } = {
  marque: ['id', 'nom'],
  modele: ['id', 'marqueId', 'nom'],
  categorie: ['id', 'nom', 'type'],
  produit: [
    'id',
    'type',
    'categorieId',
    'marqueId',
    'modeleId',
    'nom',
    'capacite',
    'couleur',
    'etat',
    'codeBarres',
    'garantieMois',
    'prixAchat',
    'prixDetail',
    'prixGros',
    'seuilGros',
    'archive',
    'photo',
  ],
  prixBoutique: ['id', 'produitId', 'boutiqueId', 'prixAchat', 'prixDetail', 'prixGros'],
  compatibilite: ['id', 'accessoireId', 'modeleId'],
  stock: ['id', 'produitId', 'boutiqueId', 'quantite', 'seuilMinimum'],
  article: [
    'id',
    'produitId',
    'boutiqueId',
    'imei',
    'imei2',
    'numeroSerie',
    'statut',
    'origine',
    'prixAchat',
    'prixRevente',
  ],
  client: [
    'id',
    'nom',
    'telephone',
    'type',
    'typePiece',
    'numeroPiece',
    'adresse',
    'plafondCredit',
    'archive',
    'photoPiece',
  ],
  garant: ['id', 'clientId', 'nom', 'telephone', 'typePiece', 'numeroPiece', 'adresse', 'lien'],
  fournisseur: ['id', 'nom', 'telephone', 'adresse', 'note', 'archive', 'dette'],
};

const versSql = (valeur: unknown): ValeurSql => {
  if (valeur === undefined || valeur === null) return null;
  if (typeof valeur === 'boolean') return valeur ? 1 : 0;
  if (typeof valeur === 'number' || typeof valeur === 'string') return valeur;
  return JSON.stringify(valeur);
};

/**
 * Écrit (ou supprime si `donnees` est nul) un élément reçu du serveur.
 * INSERT OR REPLACE remplace aussi une ligne locale provisoire qui occupe la même
 * clé unique (ex. stock créé hors ligne pour un produit et une boutique).
 */
export async function ecrireEntite<E extends EntiteSync>(
  tx: BaseSql,
  entite: E,
  id: string,
  donnees: DonneesEntites[E] | null,
): Promise<void> {
  if (!ENTITES_SYNC.includes(entite)) return;
  if (!donnees) {
    await tx.executer(`DELETE FROM ${entite} WHERE id = ?`, [id]);
    return;
  }
  const colonnes = COLONNES[entite];
  await tx.executer(
    `INSERT OR REPLACE INTO ${entite} (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
    colonnes.map((c) => versSql((donnees as unknown as Record<string, unknown>)[c])),
  );
  if (entite === 'produit') {
    await tx.executer('UPDATE produit SET recherche = ? WHERE id = ?', [
      texteRecherche(donnees as DonneesEntites['produit']),
      id,
    ]);
  }
  if (entite === 'client') {
    await tx.executer('UPDATE client SET recherche = ? WHERE id = ?', [
      texteRechercheClient(donnees as DonneesEntites['client']),
      id,
    ]);
  }
}

/** Remplit le texte de recherche des produits reçus avant la migration 2. */
export async function completerRecherche(base: BaseSql): Promise<void> {
  const produits = await base.tous<DonneesEntites['produit']>(
    'SELECT id, nom, capacite, couleur, codeBarres FROM produit WHERE recherche IS NULL',
  );
  if (produits.length === 0) return;
  await base.transaction(async (tx) => {
    for (const p of produits) {
      await tx.executer('UPDATE produit SET recherche = ? WHERE id = ?', [texteRecherche(p), p.id]);
    }
  });
}

export async function appliquerChangements(tx: BaseSql, changements: Changement[]): Promise<void> {
  for (const c of changements) {
    await ecrireEntite(tx, c.entite, c.id, c.donnees as DonneesEntites[typeof c.entite] | null);
  }
}

/** Remplace tout le catalogue et le stock par un instantané du serveur. */
export async function remplacerTout(tx: BaseSql, instantane: Instantane): Promise<void> {
  for (const entite of ENTITES_SYNC) {
    await tx.executer(`DELETE FROM ${entite}`);
    for (const donnees of instantane.donnees[entite]) {
      await ecrireEntite(tx, entite, donnees.id, donnees);
    }
  }
}

export async function lireMeta(base: BaseSql, cle: string): Promise<string | null> {
  return (
    (await base.premier<{ valeur: string | null }>('SELECT valeur FROM meta WHERE cle = ?', [cle]))
      ?.valeur ?? null
  );
}

export async function ecrireMeta(base: BaseSql, cle: string, valeur: string | null): Promise<void> {
  await base.executer('INSERT OR REPLACE INTO meta (cle, valeur) VALUES (?, ?)', [cle, valeur]);
}
