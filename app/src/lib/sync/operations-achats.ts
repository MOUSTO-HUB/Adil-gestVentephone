import {
  type AchatSync,
  type ContenuOperation,
  controlerImeis,
  ecartsTelephones,
  erreurPaiementAchat,
  erreurReception,
  type LigneAchatSync,
  normaliserImei,
  statutApresReception,
  totalAchat,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';

/**
 * Effets locaux des achats, du seuil de stock et de l'inventaire : mêmes contrôles
 * que le serveur, qui fait foi (IMEI déjà enregistré ailleurs, stock modifié entre-temps).
 */

async function ajusterDette(tx: BaseSql, fournisseurId: string, variation: number) {
  await tx.executer('UPDATE fournisseur SET dette = MAX(0, dette + ?) WHERE id = ?', [
    variation,
    fournisseurId,
  ]);
}

async function stockLocal(
  tx: BaseSql,
  produitId: string,
  boutiqueId: string,
  idProvisoire: () => string,
) {
  const stock = await tx.premier<{ id: string; quantite: number }>(
    'SELECT id, quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
    [produitId, boutiqueId],
  );
  if (stock) return stock;
  const id = idProvisoire();
  await tx.executer(
    'INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES (?, ?, ?, 0, 0)',
    [id, produitId, boutiqueId],
  );
  return { id, quantite: 0 };
}

async function achatLocal(tx: BaseSql, achatId: string, boutiqueId: string) {
  const achat = await tx.premier<AchatSync>('SELECT * FROM achat WHERE id = ? AND boutiqueId = ?', [
    achatId,
    boutiqueId,
  ]);
  if (!achat) throw new ErreurOperation('Bon d’achat introuvable dans cette boutique.');
  if (achat.statut === 'ANNULE') throw new ErreurOperation('Ce bon d’achat a été annulé.');
  return achat;
}

export async function achatEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'ACHAT_ENREGISTRER'>,
) {
  const existant = await tx.premier<AchatSync>('SELECT * FROM achat WHERE id = ?', [c.id]);
  if (existant && existant.statut !== 'BROUILLON') {
    throw new ErreurOperation(
      'Ce bon a déjà été réceptionné ou annulé : il ne peut plus être modifié.',
    );
  }
  const numero = await tx.premier('SELECT id FROM achat WHERE numero = ? AND id <> ?', [
    c.numero,
    c.id,
  ]);
  if (numero) throw new ErreurOperation(`Le numéro ${c.numero} est déjà utilisé.`);
  const montantTotal = totalAchat(c.lignes);
  await ecrireEntite(tx, 'achat', c.id, {
    id: c.id,
    boutiqueId,
    fournisseurId: c.fournisseurId,
    numero: c.numero,
    statut: 'BROUILLON',
    dateAchat: c.dateAchat,
    montantTotal,
    montantPaye: existant?.montantPaye ?? 0,
    note: c.note || null,
  });
  await tx.executer('DELETE FROM ligneAchat WHERE achatId = ?', [c.id]);
  for (const l of c.lignes) {
    await ecrireEntite(tx, 'ligneAchat', l.id, { ...l, achatId: c.id, quantiteRecue: 0 });
  }
  if (existant && existant.fournisseurId !== c.fournisseurId) {
    await ajusterDette(tx, existant.fournisseurId, -(existant.montantTotal - existant.montantPaye));
    await ajusterDette(tx, c.fournisseurId, montantTotal - existant.montantPaye);
  } else {
    await ajusterDette(tx, c.fournisseurId, montantTotal - (existant?.montantTotal ?? 0));
  }
}

export async function achatRecevoir(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'ACHAT_RECEVOIR'>,
  idProvisoire: () => string,
) {
  const achat = await achatLocal(tx, c.achatId, boutiqueId);
  const lignes = await tx.tous<LigneAchatSync & { type: 'TELEPHONE' | 'ACCESSOIRE'; nom: string }>(
    `SELECT l.*, p.type, p.nom FROM ligneAchat l JOIN produit p ON p.id = l.produitId WHERE l.achatId = ?`,
    [achat.id],
  );
  const saisis = c.lignes.flatMap((r) => r.articles?.map((a) => a.imei) ?? []);
  const connus = new Set(
    (await tx.tous<{ imei: string }>('SELECT imei FROM article')).map((a) => a.imei),
  );
  const imeis = controlerImeis(saisis, (i) => connus.has(i));
  if (imeis.invalides.length)
    throw new ErreurOperation(`IMEI invalide(s) : ${imeis.invalides.join(', ')}.`);
  if (imeis.doublons.length)
    throw new ErreurOperation(`IMEI saisi(s) deux fois : ${imeis.doublons.join(', ')}.`);
  if (imeis.dejaConnus.length) {
    throw new ErreurOperation(`IMEI déjà enregistré(s) : ${imeis.dejaConnus.join(', ')}.`);
  }
  for (const r of c.lignes) {
    const ligne = lignes.find((l) => l.id === r.ligneId);
    if (!ligne) throw new ErreurOperation('Ligne de bon inconnue.');
    const erreur = erreurReception(ligne, r);
    if (erreur) throw new ErreurOperation(erreur);
  }
  for (const r of c.lignes) {
    const ligne = lignes.find((l) => l.id === r.ligneId)!;
    const quantite = r.articles?.length ?? r.quantite ?? 0;
    for (const a of r.articles ?? []) {
      await ecrireEntite(tx, 'article', a.id, {
        id: a.id,
        produitId: ligne.produitId,
        boutiqueId,
        imei: normaliserImei(a.imei),
        imei2: null,
        numeroSerie: null,
        statut: 'EN_STOCK',
        origine: 'ACHAT',
        prixAchat: ligne.prixAchat,
        prixRevente: null,
      });
    }
    const stock = await stockLocal(tx, ligne.produitId, boutiqueId, idProvisoire);
    await tx.executer('UPDATE stock SET quantite = quantite + ? WHERE id = ?', [
      quantite,
      stock.id,
    ]);
    await tx.executer('UPDATE ligneAchat SET quantiteRecue = quantiteRecue + ? WHERE id = ?', [
      quantite,
      ligne.id,
    ]);
  }
  const apres = await tx.tous<{ quantite: number; quantiteRecue: number }>(
    'SELECT quantite, quantiteRecue FROM ligneAchat WHERE achatId = ?',
    [achat.id],
  );
  await tx.executer('UPDATE achat SET statut = ? WHERE id = ?', [
    statutApresReception(apres),
    achat.id,
  ]);
}

export async function achatPayer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'ACHAT_PAYER'>,
) {
  const achat = await achatLocal(tx, c.achatId, boutiqueId);
  const erreur = erreurPaiementAchat(achat.montantTotal, achat.montantPaye, c.montant);
  if (erreur) throw new ErreurOperation(erreur);
  await tx.executer('UPDATE achat SET montantPaye = montantPaye + ? WHERE id = ?', [
    c.montant,
    achat.id,
  ]);
  await ajusterDette(tx, achat.fournisseurId, -c.montant);
}

export async function achatAnnuler(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'ACHAT_ANNULER'>,
) {
  const achat = await achatLocal(tx, c.achatId, boutiqueId);
  const recus = await tx.premier<{ n: number }>(
    'SELECT COUNT(*) AS n FROM ligneAchat WHERE achatId = ? AND quantiteRecue > 0',
    [achat.id],
  );
  if ((recus?.n ?? 0) > 0) {
    throw new ErreurOperation(
      'Des produits de ce bon ont déjà été reçus : il ne peut plus être annulé.',
    );
  }
  await tx.executer("UPDATE achat SET statut = 'ANNULE' WHERE id = ?", [achat.id]);
  await ajusterDette(tx, achat.fournisseurId, -(achat.montantTotal - achat.montantPaye));
}

export async function stockSeuil(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'STOCK_SEUIL'>,
  idProvisoire: () => string,
) {
  const stock = await stockLocal(tx, c.produitId, boutiqueId, idProvisoire);
  await tx.executer('UPDATE stock SET seuilMinimum = ? WHERE id = ?', [c.seuilMinimum, stock.id]);
}

export async function inventaireValider(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'INVENTAIRE_VALIDER'>,
  idProvisoire: () => string,
) {
  for (const l of c.lignes) {
    const produit = await tx.premier<{ type: string; nom: string }>(
      'SELECT type, nom FROM produit WHERE id = ?',
      [l.produitId],
    );
    if (!produit) throw new ErreurOperation('Produit inconnu.');
    const stock = await stockLocal(tx, l.produitId, boutiqueId, idProvisoire);
    if (produit.type === 'ACCESSOIRE') {
      if (l.quantiteComptee === undefined)
        throw new ErreurOperation(`« ${produit.nom} » : quantité comptée manquante.`);
      await tx.executer('UPDATE stock SET quantite = ? WHERE id = ?', [
        l.quantiteComptee,
        stock.id,
      ]);
      continue;
    }
    if (l.quantiteComptee !== undefined) {
      throw new ErreurOperation(
        `« ${produit.nom} » : un téléphone se compte en scannant ses IMEI.`,
      );
    }
    const enStock = await tx.tous<{ id: string; imei: string }>(
      "SELECT id, imei FROM article WHERE produitId = ? AND boutiqueId = ? AND statut IN ('EN_STOCK', 'A_REPARER')",
      [l.produitId, boutiqueId],
    );
    const { manquants } = ecartsTelephones(enStock, l.imeis ?? []);
    for (const m of manquants) {
      await tx.executer("UPDATE article SET statut = 'REBUT' WHERE id = ?", [m.id]);
    }
    const restant = await tx.premier<{ n: number }>(
      "SELECT COUNT(*) AS n FROM article WHERE produitId = ? AND boutiqueId = ? AND statut = 'EN_STOCK'",
      [l.produitId, boutiqueId],
    );
    await tx.executer('UPDATE stock SET quantite = ? WHERE id = ?', [restant?.n ?? 0, stock.id]);
  }
}
