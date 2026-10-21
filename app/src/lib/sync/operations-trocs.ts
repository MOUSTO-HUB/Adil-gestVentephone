import {
  type ContenuOperation,
  erreurClientTroc,
  etatGlobal,
  LIBELLES_MOTIFS_IMEI,
  type MotifImeiSignale,
  type StatutArticle,
  type TrocSaisi,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';

/** Signalement actif de cet IMEI (alerte bloquante à la saisie), ou null. */
export async function imeiSignaleActif(
  base: BaseSql,
  imei: string,
): Promise<{ motif: MotifImeiSignale; note: string | null } | null> {
  return base.premier<{ motif: MotifImeiSignale; note: string | null }>(
    'SELECT motif, note FROM imeiSignale WHERE imei = ? AND actif = 1',
    [imei],
  );
}

/** Téléphone déjà connu de l'appareil avec cet IMEI (vendu autrefois, ou encore en stock). */
export function articleParImei(base: BaseSql, imei: string) {
  return base.premier<{ id: string; statut: StatutArticle; produitId: string }>(
    'SELECT id, statut, produitId FROM article WHERE imei = ? OR imei2 = ?',
    [imei, imei],
  );
}

/**
 * Troc joint à une vente, appliqué sur l'appareil : contrôles bloquants (fiche client
 * avec pièce, IMEI signalé ou déjà en stock), téléphone repris en stock, troc gardé.
 * La limite d'ajustement est contrôlée à l'écran et par le serveur.
 */
export async function trocEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  venteId: string,
  clientId: string | null,
  t: TrocSaisi,
  utilisateurId: string,
  idProvisoire: () => string,
) {
  const client = clientId
    ? await tx.premier<{ typePiece: string | null; numeroPiece: string | null }>(
        'SELECT typePiece, numeroPiece FROM client WHERE id = ?',
        [clientId],
      )
    : null;
  const erreurClient = erreurClientTroc(client);
  if (erreurClient || !clientId) throw new ErreurOperation(erreurClient ?? 'Client inconnu.');
  const produit = await tx.premier<{ type: string; modeleId: string | null }>(
    'SELECT type, modeleId FROM produit WHERE id = ?',
    [t.produitId],
  );
  if (produit?.type !== 'TELEPHONE') {
    throw new ErreurOperation('Troc : choisissez le modèle de l’appareil repris.');
  }
  const signale = await imeiSignaleActif(tx, t.imei);
  if (signale) {
    throw new ErreurOperation(
      `IMEI ${t.imei} signalé ${LIBELLES_MOTIFS_IMEI[signale.motif].toLowerCase()} : reprise refusée.`,
    );
  }
  const existant = await articleParImei(tx, t.imei);
  if (existant && existant.statut !== 'VENDU' && existant.statut !== 'REBUT') {
    throw new ErreurOperation(`IMEI ${t.imei} : ce téléphone est déjà dans le stock.`);
  }

  await ecrireEntite(tx, 'article', existant?.id ?? t.articleId, {
    id: existant?.id ?? t.articleId,
    produitId: t.produitId,
    boutiqueId,
    imei: t.imei,
    imei2: null,
    numeroSerie: null,
    statut: t.destination === 'A_REPARER' ? 'A_REPARER' : 'EN_STOCK',
    origine: 'TROC',
    prixAchat: t.valeurRetenue,
    prixRevente: t.prixRevente,
  });
  const stock = await tx.premier<{ id: string }>(
    'SELECT id FROM stock WHERE produitId = ? AND boutiqueId = ?',
    [t.produitId, boutiqueId],
  );
  if (stock) {
    await tx.executer('UPDATE stock SET quantite = quantite + 1 WHERE id = ?', [stock.id]);
  } else {
    // Ligne provisoire : remplacée par celle du serveur à la synchronisation.
    await tx.executer(
      'INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES (?, ?, ?, 1, 0)',
      [idProvisoire(), t.produitId, boutiqueId],
    );
  }
  await ecrireEntite(tx, 'troc', t.id, {
    id: t.id,
    boutiqueId,
    clientId,
    venteId,
    articleId: existant?.id ?? t.articleId,
    modeleId: produit.modeleId,
    imei: t.imei,
    etatEcran: t.etatEcran,
    etatBatterie: t.etatBatterie,
    etatBoitier: t.etatBoitier,
    fonctionne: t.fonctionne,
    etatGlobal: etatGlobal({
      ecran: t.etatEcran,
      batterie: t.etatBatterie,
      boitier: t.etatBoitier,
      fonctionne: t.fonctionne,
    }),
    note: t.note,
    valeurProposee: t.valeurProposee,
    valeurRetenue: t.valeurRetenue,
    photos: 0,
    ajustementParId: null,
    creeLe: new Date().toISOString(),
    creeParId: utilisateurId,
  });
}

/** Grille d'un modèle et d'une capacité : ses lignes sont remplacées. */
export async function grilleEnregistrer(
  tx: BaseSql,
  c: ContenuOperation<'GRILLE_REPRISE_ENREGISTRER'>,
) {
  const capacite = c.capacite?.trim() || null;
  await tx.executer(
    'DELETE FROM grilleReprise WHERE modeleId = ? AND (capacite = ? OR (capacite IS NULL AND ? IS NULL))',
    [c.modeleId, capacite, capacite],
  );
  for (const l of c.lignes) {
    await ecrireEntite(tx, 'grilleReprise', l.id, {
      id: l.id,
      modeleId: c.modeleId,
      capacite,
      etat: l.etat,
      valeur: l.valeur,
    });
  }
}

export async function imeiSignaler(tx: BaseSql, c: ContenuOperation<'IMEI_SIGNALER'>) {
  const autre = await tx.premier<{ id: string }>(
    'SELECT id FROM imeiSignale WHERE imei = ? AND id <> ?',
    [c.imei, c.id],
  );
  if (autre) {
    throw new ErreurOperation(
      `L’IMEI ${c.imei} est déjà dans la liste : modifiez son signalement.`,
    );
  }
  await ecrireEntite(tx, 'imeiSignale', c.id, { ...c, note: c.note?.trim() || null });
}

export async function articleRemettreEnVente(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'ARTICLE_REMETTRE_EN_VENTE'>,
) {
  const article = await tx.premier<{ statut: StatutArticle; imei: string }>(
    'SELECT statut, imei FROM article WHERE id = ? AND boutiqueId = ?',
    [c.articleId, boutiqueId],
  );
  if (!article) throw new ErreurOperation('Téléphone introuvable dans cette boutique.');
  if (article.statut !== 'A_REPARER') {
    throw new ErreurOperation(`IMEI ${article.imei} : n’est pas « à réparer ».`);
  }
  await tx.executer("UPDATE article SET statut = 'EN_STOCK', prixRevente = ? WHERE id = ?", [
    c.prixRevente,
    c.articleId,
  ]);
}
