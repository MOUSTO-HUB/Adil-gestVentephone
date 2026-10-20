import {
  bilanRetour,
  type ContenuOperation,
  erreurDestination,
  quantiteRetournable,
  totauxVente,
  valeurRetour,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';
import { venteEnregistrer } from './operations-ventes';

/**
 * Retour ou échange sur l'appareil : articles rendus remis en stock (ou au rebut),
 * avoir du client, nouvelle vente de l'échange. Le serveur refait tous les contrôles
 * (conditions du commerce, validation du gérant, téléphones encore vendus).
 */
export async function retourEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'RETOUR_ENREGISTRER'>,
  utilisateurId: string,
) {
  const vente = await tx.premier<{
    statut: string;
    clientId: string | null;
    sousTotal: number;
    remise: number;
  }>('SELECT statut, clientId, sousTotal, remise FROM vente WHERE id = ? AND boutiqueId = ?', [
    c.venteId,
    boutiqueId,
  ]);
  if (!vente) throw new ErreurOperation('Vente introuvable dans cette boutique.');
  if (vente.statut === 'ANNULEE') throw new ErreurOperation('Cette vente a été annulée.');

  let valeur = 0;
  const lignes: {
    ligne: (typeof c.lignes)[number];
    produitId: string;
    articleId: string | null;
    montant: number;
  }[] = [];
  const rendus = new Map<string, number>();
  for (const l of c.lignes) {
    const lv = await tx.premier<{
      produitId: string;
      articleId: string | null;
      quantite: number;
      prixUnitaire: number;
      nom: string;
      type: 'TELEPHONE' | 'ACCESSOIRE';
      statut: string | null;
      dejaRendu: number;
    }>(
      `SELECT l.produitId, l.articleId, l.quantite, l.prixUnitaire, p.nom, p.type, a.statut,
              (SELECT COALESCE(SUM(r.quantite), 0) FROM ligneRetour r WHERE r.ligneVenteId = l.id) AS dejaRendu
         FROM ligneVente l JOIN produit p ON p.id = l.produitId LEFT JOIN article a ON a.id = l.articleId
        WHERE l.id = ? AND l.venteId = ?`,
      [l.ligneVenteId, c.venteId],
    );
    if (!lv) throw new ErreurOperation('Un des articles ne fait pas partie de cette vente.');
    const deja = lv.dejaRendu + (rendus.get(l.ligneVenteId) ?? 0);
    if (l.quantite > quantiteRetournable(lv.quantite, deja)) {
      throw new ErreurOperation(`« ${lv.nom} » : ${deja} sur ${lv.quantite} déjà rendu(s).`);
    }
    rendus.set(l.ligneVenteId, deja - lv.dejaRendu + l.quantite);
    const erreur = erreurDestination(lv.type, l.destination, l.prixRevente);
    if (erreur) throw new ErreurOperation(`« ${lv.nom} » : ${erreur}`);
    if (lv.articleId && lv.statut !== 'VENDU') {
      throw new ErreurOperation(`« ${lv.nom} » : ce téléphone n’est plus enregistré comme vendu.`);
    }
    const montant = valeurRetour(lv, l.quantite, vente);
    valeur += montant;
    lignes.push({ ligne: l, produitId: lv.produitId, articleId: lv.articleId, montant });
  }
  if (c.type === 'AVOIR' && !vente.clientId) {
    throw new ErreurOperation('Un avoir est au nom du client : cette vente n’a pas de client.');
  }
  const totalEchange = c.echange ? totauxVente(c.echange.lignes, c.echange.remise).total : 0;
  const bilan = bilanRetour(c.type, valeur, totalEchange);
  if (bilan.aRendre > 0 && !c.remboursement) {
    throw new ErreurOperation('Indiquez comment le client est remboursé.');
  }
  if (c.echange) await venteEnregistrer(tx, boutiqueId, c.echange, utilisateurId, bilan.reprise);

  for (const { ligne: l, produitId, articleId, montant } of lignes) {
    await ecrireEntite(tx, 'ligneRetour', l.id, {
      id: l.id,
      retourId: c.id,
      ligneVenteId: l.ligneVenteId,
      articleId,
      quantite: l.quantite,
      destination: l.destination,
      montant,
      prixRevente: l.prixRevente,
    });
    if (articleId) {
      await tx.executer(
        `UPDATE article SET statut = ?, boutiqueId = ?,
                prixRevente = CASE ? WHEN 'OCCASION' THEN ? WHEN 'REMISE_EN_STOCK' THEN NULL ELSE prixRevente END
          WHERE id = ?`,
        [
          l.destination === 'REBUT' ? 'REBUT' : 'EN_STOCK',
          boutiqueId,
          l.destination,
          l.prixRevente,
          articleId,
        ],
      );
    }
    if (l.destination !== 'REBUT') {
      await tx.executer(
        'UPDATE stock SET quantite = quantite + ? WHERE produitId = ? AND boutiqueId = ?',
        [l.quantite, produitId, boutiqueId],
      );
    }
  }
  if (bilan.avoir > 0) {
    await tx.executer('UPDATE client SET soldeAvoir = soldeAvoir + ? WHERE id = ?', [
      bilan.avoir,
      vente.clientId,
    ]);
  }
  await ecrireEntite(tx, 'retour', c.id, {
    id: c.id,
    boutiqueId,
    venteId: c.venteId,
    type: c.type,
    etatAppareil: c.etatAppareil,
    motif: c.motif,
    valeur,
    montantRembourse: bilan.aRendre,
    moyenRemboursement: bilan.aRendre > 0 ? (c.remboursement?.moyen ?? null) : null,
    referenceRemboursement: bilan.aRendre > 0 ? c.remboursement?.reference?.trim() || null : null,
    avoir: bilan.avoir,
    venteEchangeId: c.echange?.id ?? null,
    caisseId: c.caisseId ?? null,
    dateRetour: new Date(c.dateRetour).toISOString(),
    creeParId: utilisateurId,
    valideParId: null,
  });
}
