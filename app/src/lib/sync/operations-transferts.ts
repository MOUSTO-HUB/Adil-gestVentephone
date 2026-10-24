import {
  bilanReception,
  type ContenuOperation,
  controlerSortieArticle,
  erreurBoutiquesTransfert,
  type StatutArticle,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';

/** Stock d'un produit dans une boutique, ligne provisoire créée au besoin. */
async function ajusterStock(
  tx: BaseSql,
  produitId: string,
  boutiqueId: string,
  delta: number,
  idProvisoire: () => string,
) {
  const stock = await tx.premier<{ id: string }>(
    'SELECT id FROM stock WHERE produitId = ? AND boutiqueId = ?',
    [produitId, boutiqueId],
  );
  if (stock) {
    await tx.executer('UPDATE stock SET quantite = quantite + ? WHERE id = ?', [delta, stock.id]);
  } else {
    await tx.executer(
      'INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES (?, ?, ?, ?, 0)',
      [idProvisoire(), produitId, boutiqueId, delta],
    );
  }
}

/** Demande faite par la boutique de l'opération (celle qui reçoit). */
export async function transfertDemander(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'TRANSFERT_DEMANDER'>,
  utilisateurId: string,
) {
  const erreur = erreurBoutiquesTransfert(c.boutiqueDepartId, boutiqueId);
  if (erreur) throw new ErreurOperation(erreur);
  await ecrireEntite(tx, 'transfert', c.id, {
    id: c.id,
    numero: c.numero,
    boutiqueDepartId: c.boutiqueDepartId,
    boutiqueArriveeId: boutiqueId,
    statut: 'DEMANDE',
    note: c.note,
    noteReception: null,
    envoyeLe: null,
    recuLe: null,
    creeLe: new Date().toISOString(),
    creeParId: utilisateurId,
  });
  for (const l of c.lignes) {
    await ecrireEntite(tx, 'ligneTransfert', l.id, {
      id: l.id,
      transfertId: c.id,
      produitId: l.produitId,
      articleId: null,
      imei: null,
      quantite: l.quantite,
      quantiteRecue: null,
    });
  }
}

/** Envoi depuis la boutique de l'opération : téléphones EN_TRANSFERT, stock diminué. */
export async function transfertEnvoyer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'TRANSFERT_ENVOYER'>,
  utilisateurId: string,
  idProvisoire: () => string,
) {
  const erreur = erreurBoutiquesTransfert(boutiqueId, c.boutiqueArriveeId);
  if (erreur) throw new ErreurOperation(erreur);
  const existant = await tx.premier<{
    statut: string;
    numero: string;
    note: string | null;
    creeLe: string;
  }>('SELECT statut, numero, note, creeLe FROM transfert WHERE id = ?', [c.id]);
  if (existant && existant.statut !== 'DEMANDE') {
    throw new ErreurOperation('Ce transfert est déjà parti ou annulé.');
  }
  const imeis = new Map<string, string>();
  for (const l of c.lignes) {
    if (l.articleId) {
      const article = await tx.premier<{
        statut: StatutArticle;
        boutiqueId: string;
        imei: string;
        produitId: string;
      }>('SELECT statut, boutiqueId, imei, produitId FROM article WHERE id = ?', [l.articleId]);
      const controle = controlerSortieArticle(article, boutiqueId);
      if (!controle.ok)
        throw new ErreurOperation(`IMEI ${article?.imei ?? '?'} : ${controle.motif}`);
      imeis.set(l.articleId, article!.imei);
    } else {
      const stock = await tx.premier<{ quantite: number }>(
        'SELECT quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
        [l.produitId, boutiqueId],
      );
      if ((stock?.quantite ?? 0) < l.quantite) {
        throw new ErreurOperation(`Stock insuffisant : ${stock?.quantite ?? 0} disponible(s).`);
      }
    }
  }
  await tx.executer('DELETE FROM ligneTransfert WHERE transfertId = ?', [c.id]);
  await ecrireEntite(tx, 'transfert', c.id, {
    id: c.id,
    numero: existant?.numero ?? c.numero,
    boutiqueDepartId: boutiqueId,
    boutiqueArriveeId: c.boutiqueArriveeId,
    statut: 'ENVOYE',
    note: c.note ?? existant?.note ?? null,
    noteReception: null,
    envoyeLe: new Date().toISOString(),
    recuLe: null,
    creeLe: existant?.creeLe ?? new Date().toISOString(),
    creeParId: utilisateurId,
  });
  for (const l of c.lignes) {
    await ecrireEntite(tx, 'ligneTransfert', l.id, {
      id: l.id,
      transfertId: c.id,
      produitId: l.produitId,
      articleId: l.articleId,
      imei: l.articleId ? (imeis.get(l.articleId) ?? null) : null,
      quantite: l.quantite,
      quantiteRecue: null,
    });
    if (l.articleId) {
      await tx.executer("UPDATE article SET statut = 'EN_TRANSFERT' WHERE id = ?", [l.articleId]);
    }
    await ajusterStock(tx, l.produitId, boutiqueId, -l.quantite, idProvisoire);
  }
}

/** Réception à la boutique de l'opération : seul ce qui est scanné ou compté entre en stock. */
export async function transfertRecevoir(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'TRANSFERT_RECEVOIR'>,
  idProvisoire: () => string,
) {
  const t = await tx.premier<{ statut: string; boutiqueArriveeId: string }>(
    'SELECT statut, boutiqueArriveeId FROM transfert WHERE id = ?',
    [c.transfertId],
  );
  if (!t || t.boutiqueArriveeId !== boutiqueId) {
    throw new ErreurOperation('Transfert introuvable pour cette boutique.');
  }
  if (t.statut !== 'ENVOYE') throw new ErreurOperation('Ce transfert n’est pas en route.');
  const lignes = await tx.tous<{
    id: string;
    produitId: string;
    articleId: string | null;
    quantite: number;
  }>('SELECT id, produitId, articleId, quantite FROM ligneTransfert WHERE transfertId = ?', [
    c.transfertId,
  ]);
  const bilan = bilanReception(lignes, c);
  for (const l of lignes) {
    const recu = bilan.recues.find((r) => r.ligneId === l.id)!.quantite;
    await tx.executer('UPDATE ligneTransfert SET quantiteRecue = ? WHERE id = ?', [recu, l.id]);
    if (recu === 0) continue;
    // Un téléphone connu de l'appareil (propriétaire des deux boutiques) change de boutique ;
    // sinon il arrive avec la synchronisation.
    if (l.articleId) {
      await tx.executer("UPDATE article SET statut = 'EN_STOCK', boutiqueId = ? WHERE id = ?", [
        boutiqueId,
        l.articleId,
      ]);
    }
    await ajusterStock(tx, l.produitId, boutiqueId, recu, idProvisoire);
  }
  await tx.executer(
    "UPDATE transfert SET statut = 'RECU', recuLe = ?, noteReception = ? WHERE id = ?",
    [c.recuLe, c.note, c.transfertId],
  );
}

export async function transfertAnnuler(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'TRANSFERT_ANNULER'>,
  idProvisoire: () => string,
) {
  const t = await tx.premier<{
    statut: string;
    boutiqueDepartId: string;
    boutiqueArriveeId: string;
  }>('SELECT statut, boutiqueDepartId, boutiqueArriveeId FROM transfert WHERE id = ?', [
    c.transfertId,
  ]);
  if (!t || (t.boutiqueDepartId !== boutiqueId && t.boutiqueArriveeId !== boutiqueId)) {
    throw new ErreurOperation('Transfert introuvable pour cette boutique.');
  }
  if (t.statut === 'RECU') throw new ErreurOperation('Ce transfert a déjà été reçu.');
  if (t.statut === 'ANNULE') return;
  if (t.statut === 'ENVOYE') {
    if (t.boutiqueDepartId !== boutiqueId) {
      throw new ErreurOperation('Un transfert parti s’annule depuis la boutique de départ.');
    }
    const lignes = await tx.tous<{ produitId: string; articleId: string | null; quantite: number }>(
      'SELECT produitId, articleId, quantite FROM ligneTransfert WHERE transfertId = ?',
      [c.transfertId],
    );
    for (const l of lignes) {
      if (l.articleId) {
        await tx.executer(
          "UPDATE article SET statut = 'EN_STOCK' WHERE id = ? AND statut = 'EN_TRANSFERT'",
          [l.articleId],
        );
      }
      await ajusterStock(tx, l.produitId, boutiqueId, l.quantite, idProvisoire);
    }
  }
  await tx.executer("UPDATE transfert SET statut = 'ANNULE' WHERE id = ?", [c.transfertId]);
}
