import {
  type ContenuOperation,
  idPrixBoutiqueProvisoire,
  type ProduitSync,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { nomDejaPris } from './doublons';
import { ErreurOperation } from './erreurs';

export async function marqueEnregistrer(tx: BaseSql, c: ContenuOperation<'MARQUE_ENREGISTRER'>) {
  const doublon = await nomDejaPris(tx, 'marque', c.id, c.nom);
  if (doublon) throw new ErreurOperation(`La marque « ${doublon} » existe déjà.`);
  await ecrireEntite(tx, 'marque', c.id, { id: c.id, nom: c.nom.trim() });
}

export async function modeleEnregistrer(tx: BaseSql, c: ContenuOperation<'MODELE_ENREGISTRER'>) {
  const doublon = await nomDejaPris(tx, 'modele', c.id, c.nom, {
    colonne: 'marqueId',
    valeur: c.marqueId,
  });
  if (doublon) throw new ErreurOperation(`Le modèle « ${doublon} » existe déjà.`);
  await ecrireEntite(tx, 'modele', c.id, { id: c.id, marqueId: c.marqueId, nom: c.nom.trim() });
}

export async function categorieEnregistrer(
  tx: BaseSql,
  c: ContenuOperation<'CATEGORIE_ENREGISTRER'>,
) {
  const doublon = await nomDejaPris(tx, 'categorie', c.id, c.nom);
  if (doublon) throw new ErreurOperation(`La catégorie « ${doublon} » existe déjà.`);
  await ecrireEntite(tx, 'categorie', c.id, { id: c.id, nom: c.nom.trim(), type: c.type });
}

export async function produitEnregistrer(tx: BaseSql, c: ContenuOperation<'PRODUIT_ENREGISTRER'>) {
  const existant = await tx.premier<{ type: string; photo: string | null }>(
    'SELECT type, photo FROM produit WHERE id = ?',
    [c.id],
  );
  if (existant && existant.type !== c.type) {
    throw new ErreurOperation(
      'Le type d’un produit (téléphone ou accessoire) ne peut pas changer.',
    );
  }
  if (c.codeBarres) {
    const doublon = await tx.premier<{ nom: string }>(
      'SELECT nom FROM produit WHERE codeBarres = ? AND id <> ?',
      [c.codeBarres, c.id],
    );
    if (doublon) throw new ErreurOperation(`Code-barres déjà utilisé par « ${doublon.nom} ».`);
  }
  const { compatibles, ...champs } = c;
  const produit: ProduitSync = {
    ...champs,
    capacite: c.capacite || null,
    couleur: c.couleur || null,
    codeBarres: c.codeBarres || null,
    photo: existant?.photo ?? null,
  };
  await ecrireEntite(tx, 'produit', c.id, produit);
  await tx.executer('DELETE FROM compatibilite WHERE accessoireId = ?', [c.id]);
  for (const modeleId of new Set(compatibles)) {
    const id = `${c.id}:${modeleId}`;
    await ecrireEntite(tx, 'compatibilite', id, { id, accessoireId: c.id, modeleId });
  }
}

export async function prixBoutiqueEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'PRIX_BOUTIQUE_ENREGISTRER'>,
) {
  if (c.prixAchat === null && c.prixDetail === null && c.prixGros === null) {
    await tx.executer('DELETE FROM prixBoutique WHERE produitId = ? AND boutiqueId = ?', [
      c.produitId,
      boutiqueId,
    ]);
    return;
  }
  const existant = await tx.premier<{ id: string }>(
    'SELECT id FROM prixBoutique WHERE produitId = ? AND boutiqueId = ?',
    [c.produitId, boutiqueId],
  );
  const id = existant?.id ?? idPrixBoutiqueProvisoire(c.produitId, boutiqueId);
  await ecrireEntite(tx, 'prixBoutique', id, { id, boutiqueId, ...c });
}
