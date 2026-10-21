import type { ContenuOperation } from '@gestvente/commun';
import type { BaseSql } from '../base/sql';
import { ErreurOperation } from './erreurs';

/**
 * Envoi d'une facture ou d'un reçu : rien n'est écrit sur l'appareil, le serveur
 * envoie le message quand l'opération lui parvient. On vérifie seulement la vente
 * et le numéro, pour prévenir tout de suite le vendeur.
 */
export async function messageEnvoyer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'MESSAGE_ENVOYER'>,
) {
  const vente = await tx.premier<{ statut: string; telephone: string | null }>(
    `SELECT v.statut, c.telephone FROM vente v LEFT JOIN client c ON c.id = v.clientId
      WHERE v.id = ? AND v.boutiqueId = ?`,
    [c.venteId, boutiqueId],
  );
  if (!vente) throw new ErreurOperation('Vente introuvable dans cette boutique.');
  if (vente.statut === 'ANNULEE') throw new ErreurOperation('Vente annulée : rien à envoyer.');
  if (!c.telephone && !vente.telephone) {
    throw new ErreurOperation('Aucun numéro : choisissez le client ou saisissez son numéro.');
  }
}
