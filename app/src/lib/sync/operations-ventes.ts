import {
  type ContenuOperation,
  controlerPaiements,
  controlerSortieArticle,
  finGarantie,
  type StatutArticle,
  totauxVente,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';

/**
 * Vente enregistrée sur l'appareil (en moins de 2 secondes, même hors ligne) :
 * téléphones vendus, stock diminué, vente et paiements gardés pour la caisse.
 * Le serveur refait les contrôles (prix de gros, remise, IMEI vendu ailleurs).
 */
export async function venteEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'VENTE_ENREGISTRER'>,
  vendeurId: string,
) {
  if (
    await tx.premier('SELECT id FROM vente WHERE boutiqueId = ? AND numero = ?', [
      boutiqueId,
      c.numero,
    ])
  ) {
    throw new ErreurOperation(`Le numéro de facture ${c.numero} est déjà utilisé.`);
  }
  const { sousTotal, total } = totauxVente(c.lignes, c.remise);
  if (c.remise > sousTotal) throw new ErreurOperation('La remise dépasse le montant de la vente.');
  const paiements = controlerPaiements(total, c.paiements);
  if (!paiements.ok) throw new ErreurOperation(paiements.motif);
  const dateVente = new Date(c.dateVente);

  for (const l of c.lignes) {
    const produit = await tx.premier<{
      nom: string;
      type: string;
      garantieMois: number;
      prixAchat: number | null;
    }>('SELECT nom, type, garantieMois, prixAchat FROM produit WHERE id = ?', [l.produitId]);
    if (!produit) throw new ErreurOperation('Produit inconnu.');
    let prixAchat = produit.prixAchat;
    if (l.articleId) {
      const article = await tx.premier<{
        statut: StatutArticle;
        boutiqueId: string;
        imei: string;
        prixAchat: number | null;
      }>('SELECT statut, boutiqueId, imei, prixAchat FROM article WHERE id = ?', [l.articleId]);
      const controle = controlerSortieArticle(article, boutiqueId);
      if (!controle.ok)
        throw new ErreurOperation(`IMEI ${article?.imei ?? '?'} : ${controle.motif}`);
      prixAchat = article?.prixAchat ?? null;
      await tx.executer("UPDATE article SET statut = 'VENDU' WHERE id = ?", [l.articleId]);
    } else {
      const stock = await tx.premier<{ quantite: number }>(
        'SELECT quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
        [l.produitId, boutiqueId],
      );
      if ((stock?.quantite ?? 0) < l.quantite) {
        throw new ErreurOperation(
          `« ${produit.nom} » : ${stock?.quantite ?? 0} en stock seulement.`,
        );
      }
    }
    await tx.executer(
      'UPDATE stock SET quantite = quantite - ? WHERE produitId = ? AND boutiqueId = ?',
      [l.quantite, l.produitId, boutiqueId],
    );
    await ecrireEntite(tx, 'ligneVente', l.id, {
      id: l.id,
      venteId: c.id,
      produitId: l.produitId,
      articleId: l.articleId,
      quantite: l.quantite,
      tarif: l.tarif,
      prixUnitaire: l.prixUnitaire,
      total: l.quantite * l.prixUnitaire,
      prixAchat,
      finGarantie: finGarantie(dateVente, produit.garantieMois)?.toISOString() ?? null,
    });
  }
  for (const p of c.paiements) {
    await ecrireEntite(tx, 'paiementVente', p.id, {
      ...p,
      reference: p.reference?.trim() || null,
      venteId: c.id,
    });
  }
  await ecrireEntite(tx, 'vente', c.id, {
    id: c.id,
    boutiqueId,
    numero: c.numero,
    clientId: c.clientId,
    vendeurId,
    mode: 'COMPTANT',
    statut: 'VALIDEE',
    sousTotal,
    remise: c.remise,
    total,
    montantPaye: total,
    renduMonnaie: paiements.rendu,
    dateVente: dateVente.toISOString(),
    annuleLe: null,
    motifAnnulation: null,
  });
}

export async function venteAnnuler(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'VENTE_ANNULER'>,
) {
  const vente = await tx.premier<{ statut: string }>(
    'SELECT statut FROM vente WHERE id = ? AND boutiqueId = ?',
    [c.venteId, boutiqueId],
  );
  if (!vente) throw new ErreurOperation('Vente introuvable dans cette boutique.');
  if (vente.statut === 'ANNULEE') return;
  const lignes = await tx.tous<{ produitId: string; articleId: string | null; quantite: number }>(
    'SELECT produitId, articleId, quantite FROM ligneVente WHERE venteId = ?',
    [c.venteId],
  );
  for (const l of lignes) {
    if (l.articleId) {
      await tx.executer(
        "UPDATE article SET statut = 'EN_STOCK' WHERE id = ? AND statut = 'VENDU'",
        [l.articleId],
      );
    }
    await tx.executer(
      'UPDATE stock SET quantite = quantite + ? WHERE produitId = ? AND boutiqueId = ?',
      [l.quantite, l.produitId, boutiqueId],
    );
  }
  await tx.executer(
    "UPDATE vente SET statut = 'ANNULEE', annuleLe = ?, motifAnnulation = ? WHERE id = ?",
    [new Date().toISOString(), c.motif, c.venteId],
  );
}
