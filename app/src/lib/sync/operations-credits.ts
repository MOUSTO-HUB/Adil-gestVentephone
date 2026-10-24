import {
  type ContenuOperation,
  type CreditSaisi,
  echeancier,
  erreurConditionsCredit,
  erreurFicheCredit,
  erreurPlafondCredit,
  repartirEncaissement,
} from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';

/** Fiche du client pour un crédit (champs exigés et plafond). */
export function ficheCredit(base: BaseSql, clientId: string) {
  return base.premier<{
    nom: string;
    telephone: string;
    typePiece: string | null;
    numeroPiece: string | null;
    adresse: string | null;
    plafondCredit: number | null;
  }>(
    'SELECT nom, telephone, typePiece, numeroPiece, adresse, plafondCredit FROM client WHERE id = ?',
    [clientId],
  );
}

/** Reste dû par le client sur ses crédits en cours connus de l'appareil. */
export async function encoursClient(base: BaseSql, clientId: string): Promise<number> {
  const ligne = await base.premier<{ encours: number | null }>(
    "SELECT SUM(montantRestant) AS encours FROM credit WHERE clientId = ? AND statut = 'EN_COURS'",
    [clientId],
  );
  return ligne?.encours ?? 0;
}

/**
 * Crédit joint à une vente, sur l'appareil : fiche complète, conditions, plafond
 * (encours connu de l'appareil ; le serveur recontrôle sur tout le commerce), puis
 * crédit et tranches de l'échéancier.
 */
export async function creditEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  vente: { id: string; numero: string; clientId: string | null; dateVente: string },
  c: CreditSaisi,
  total: number,
  utilisateurId: string,
) {
  const client = vente.clientId ? await ficheCredit(tx, vente.clientId) : null;
  const fiche = erreurFicheCredit(client);
  if (fiche || !client || !vente.clientId) throw new ErreurOperation(fiche ?? 'Client inconnu.');
  const conditions = erreurConditionsCredit(total, c.apport, c.nombreTranches);
  if (conditions) throw new ErreurOperation(conditions);
  const plafond = erreurPlafondCredit(
    client.plafondCredit,
    await encoursClient(tx, vente.clientId),
    total - c.apport,
  );
  if (plafond) throw new ErreurOperation(plafond);

  const finance = total - c.apport;
  await ecrireEntite(tx, 'credit', c.id, {
    id: c.id,
    boutiqueId,
    venteId: vente.id,
    numeroVente: vente.numero,
    clientId: vente.clientId,
    garantId: c.garantId,
    montantTotal: total,
    apport: c.apport,
    montantFinance: finance,
    montantRestant: finance,
    nombreTranches: c.nombreTranches,
    frequence: c.frequence,
    premiereEcheance: c.premiereEcheance,
    statut: 'EN_COURS',
    penaliteActive: false,
    soldeLe: null,
    creeLe: vente.dateVente,
    creeParId: utilisateurId,
  });
  const tranches = echeancier(finance, c.nombreTranches, c.frequence, c.premiereEcheance);
  for (const [i, t] of tranches.entries()) {
    await ecrireEntite(tx, 'echeance', c.echeanceIds[i], {
      id: c.echeanceIds[i],
      creditId: c.id,
      numero: t.numero,
      dateEcheance: t.date,
      montant: t.montant,
      montantPaye: 0,
      penalite: 0,
      soldeeLe: null,
      dernierRappel: null,
      nombreRelances: 0,
    });
  }
}

/** Encaissement d'une tranche sur l'appareil (réparti de la plus ancienne à la plus récente). */
export async function creditEncaisser(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'CREDIT_ENCAISSER'>,
  utilisateurId: string,
) {
  const credit = await tx.premier<{ statut: string; montantRestant: number }>(
    'SELECT statut, montantRestant FROM credit WHERE id = ? AND boutiqueId = ?',
    [c.creditId, boutiqueId],
  );
  if (!credit) throw new ErreurOperation('Crédit introuvable dans cette boutique.');
  if (credit.statut !== 'EN_COURS') throw new ErreurOperation('Ce crédit est déjà soldé.');
  if (c.moyen !== 'ESPECES' && !c.reference?.trim()) {
    throw new ErreurOperation('Saisissez la référence de la transaction.');
  }
  const echeances = await tx.tous<{
    id: string;
    numero: number;
    dateEcheance: string;
    montant: number;
    montantPaye: number;
    penalite: number;
  }>(
    'SELECT id, numero, dateEcheance, montant, montantPaye, penalite FROM echeance WHERE creditId = ?',
    [c.creditId],
  );
  const repartition = repartirEncaissement(echeances, c.montant);
  if (!repartition.ok) throw new ErreurOperation(repartition.motif);
  for (const part of repartition.parts) {
    const e = echeances.find((x) => x.numero === part.numero)!;
    const paye = e.montantPaye + part.montant;
    await tx.executer('UPDATE echeance SET montantPaye = ?, soldeeLe = ? WHERE id = ?', [
      paye,
      paye >= e.montant + e.penalite ? c.dateEncaissement : null,
      e.id,
    ]);
  }
  const restant = credit.montantRestant - c.montant;
  await tx.executer('UPDATE credit SET montantRestant = ?, statut = ?, soldeLe = ? WHERE id = ?', [
    restant,
    restant <= 0 ? 'SOLDE' : 'EN_COURS',
    restant <= 0 ? c.dateEncaissement : null,
    c.creditId,
  ]);
  await ecrireEntite(tx, 'encaissement', c.id, {
    id: c.id,
    creditId: c.creditId,
    caisseId: c.caisseId,
    moyen: c.moyen,
    montant: c.montant,
    reference: c.reference?.trim() || null,
    creeLe: c.dateEncaissement,
    creeParId: utilisateurId,
  });
}
