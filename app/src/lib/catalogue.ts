import { motsRecherche, normaliserImei } from '@gestvente/commun';
import type { BaseSql, ValeurSql } from './base/sql';

export interface ProduitTrouve {
  id: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  photo: string | null;
  prixDetail: number;
  prixGros: number;
  quantite: number;
  seuilMinimum: number;
  archive: number;
}

export const LIMITE_RESULTATS = 100;

/**
 * Recherche dans la base locale (hors ligne) : chaque mot doit apparaître dans le
 * nom, la capacité, la couleur ou le code-barres (sans tenir compte des accents) ;
 * un code-barres ou un IMEI exact trouve aussi son produit.
 */
export async function rechercherProduits(
  base: BaseSql,
  boutiqueId: string,
  terme: string,
  options: {
    archives?: boolean;
    limite?: number;
    /** Filtres de la vente : type, marque, modèle (un accessoire compatible compte). */
    type?: 'TELEPHONE' | 'ACCESSOIRE' | null;
    marqueId?: string | null;
    modeleId?: string | null;
    /** Produits en stock d'abord. */
    enStockDabord?: boolean;
  } = {},
): Promise<ProduitTrouve[]> {
  const mots = motsRecherche(terme);
  const brut = terme.trim();
  const imei = normaliserImei(brut);
  const conditions: string[] = [];
  const params: ValeurSql[] = [boutiqueId, boutiqueId];

  if (mots.length > 0) {
    const parMots = mots.map(() => 'p.recherche LIKE ?').join(' AND ');
    params.push(...mots.map((m) => `%${m}%`));
    conditions.push(`(${parMots})`);
    conditions.push('p.codeBarres = ?');
    params.push(brut);
    if (/^\d{14,16}$/.test(imei)) {
      conditions.push(
        'p.id IN (SELECT produitId FROM article WHERE boutiqueId = ? AND (imei = ? OR imei2 = ?))',
      );
      params.push(boutiqueId, imei, imei);
    }
  }
  const filtreArchives = options.archives ? '' : 'AND p.archive = 0';
  const filtres: string[] = [];
  const paramsFiltres: ValeurSql[] = [];
  if (options.type) {
    filtres.push('p.type = ?');
    paramsFiltres.push(options.type);
  }
  if (options.modeleId) {
    filtres.push(
      '(p.modeleId = ? OR p.id IN (SELECT accessoireId FROM compatibilite WHERE modeleId = ?))',
    );
    paramsFiltres.push(options.modeleId, options.modeleId);
  } else if (options.marqueId) {
    filtres.push(
      `(p.marqueId = ? OR p.id IN (SELECT c.accessoireId FROM compatibilite c
          JOIN modele mo ON mo.id = c.modeleId WHERE mo.marqueId = ?))`,
    );
    paramsFiltres.push(options.marqueId, options.marqueId);
  }
  return base.tous<ProduitTrouve>(
    `SELECT p.id, p.nom, p.type, p.photo, p.archive,
            COALESCE(pb.prixDetail, p.prixDetail) AS prixDetail,
            COALESCE(pb.prixGros, p.prixGros) AS prixGros,
            COALESCE(s.quantite, 0) AS quantite, COALESCE(s.seuilMinimum, 0) AS seuilMinimum
       FROM produit p
       LEFT JOIN prixBoutique pb ON pb.produitId = p.id AND pb.boutiqueId = ?
       LEFT JOIN stock s ON s.produitId = p.id AND s.boutiqueId = ?
      WHERE 1 = 1 ${filtreArchives}
        ${conditions.length ? `AND (${conditions.join(' OR ')})` : ''}
        ${filtres.map((f) => `AND ${f}`).join(' ')}
      ORDER BY ${options.enStockDabord ? '(COALESCE(s.quantite, 0) > 0) DESC,' : ''} p.recherche, p.nom
      LIMIT ${options.limite ?? LIMITE_RESULTATS}`,
    [...params, ...paramsFiltres],
  );
}

/** Marques du catalogue (filtres de la recherche). */
export function marquesCatalogue(base: BaseSql) {
  return base.tous<{ id: string; nom: string }>('SELECT id, nom FROM marque ORDER BY nom');
}

/** Modèles d'une marque, dans l'ordre naturel (A5 avant A10). */
export async function modelesMarque(base: BaseSql, marqueId: string) {
  const modeles = await base.tous<{ id: string; nom: string }>(
    'SELECT id, nom FROM modele WHERE marqueId = ?',
    [marqueId],
  );
  return modeles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
}

/**
 * Code lu par un lecteur ou la caméra : produit dont c'est le code-barres, ou
 * téléphone de la boutique dont c'est l'IMEI. Nul si rien ne correspond exactement.
 */
export async function trouverParCode(
  base: BaseSql,
  boutiqueId: string,
  code: string,
): Promise<{ produitId: string; articleId: string | null } | null> {
  const brut = code.trim();
  if (!brut) return null;
  const parCode = await base.premier<{ id: string }>(
    'SELECT id FROM produit WHERE codeBarres = ?',
    [brut],
  );
  if (parCode) return { produitId: parCode.id, articleId: null };
  const imei = normaliserImei(brut);
  const article = await base.premier<{ id: string; produitId: string }>(
    'SELECT id, produitId FROM article WHERE boutiqueId = ? AND (imei = ? OR imei2 = ?)',
    [boutiqueId, imei, imei],
  );
  return article ? { produitId: article.produitId, articleId: article.id } : null;
}
