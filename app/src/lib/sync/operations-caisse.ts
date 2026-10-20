import { bilanCaisse, type ContenuOperation, ecartsCaisse, erreurCloture } from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { caisseOuverte, lireCaisse, mouvementsCaisse } from '../caisse-session';
import { ErreurOperation } from './erreurs';

/** Caisse et dépenses sur l'appareil ; le serveur recalcule l'attendu à la clôture. */

export async function caisseOuvrir(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'CAISSE_OUVRIR'>,
  utilisateur: { id: string; nom: string },
) {
  if (await caisseOuverte(tx, boutiqueId, utilisateur.id)) {
    throw new ErreurOperation('Votre caisse est déjà ouverte : clôturez-la d’abord.');
  }
  await ecrireEntite(tx, 'caisse', c.id, {
    id: c.id,
    boutiqueId,
    utilisateurId: utilisateur.id,
    vendeur: utilisateur.nom,
    statut: 'OUVERTE',
    ouverteLe: new Date(c.ouverteLe).toISOString(),
    fondInitial: c.fondInitial,
    clotureeLe: null,
    comptage: null,
    theorique: null,
    ecart: null,
    commentaire: null,
    validePar: null,
    valideLe: null,
    commentaireValidation: null,
  });
}

export async function caisseCloturer(tx: BaseSql, c: ContenuOperation<'CAISSE_CLOTURER'>) {
  const caisse = await lireCaisse(tx, c.caisseId);
  if (!caisse) throw new ErreurOperation('Caisse introuvable.');
  if (caisse.statut !== 'OUVERTE') throw new ErreurOperation('Cette caisse est déjà clôturée.');
  const { theorique } = bilanCaisse(await mouvementsCaisse(tx, caisse.id));
  const ecarts = ecartsCaisse(theorique, c.comptage);
  const erreur = erreurCloture(ecarts.parMoyen, c.commentaire);
  if (erreur) throw new ErreurOperation(erreur);
  await ecrireEntite(tx, 'caisse', caisse.id, {
    ...caisse,
    statut: 'CLOTUREE',
    clotureeLe: new Date(c.clotureeLe).toISOString(),
    comptage: c.comptage,
    theorique,
    ecart: ecarts.total,
    commentaire: c.commentaire?.trim() || null,
  });
}

export async function caisseValider(
  tx: BaseSql,
  c: ContenuOperation<'CAISSE_VALIDER'>,
  valideur: string,
) {
  const caisse = await lireCaisse(tx, c.caisseId);
  if (!caisse) throw new ErreurOperation('Caisse introuvable.');
  if (caisse.statut === 'OUVERTE')
    throw new ErreurOperation('La caisse doit d’abord être clôturée.');
  if (caisse.statut === 'VALIDEE') return;
  await ecrireEntite(tx, 'caisse', caisse.id, {
    ...caisse,
    statut: 'VALIDEE',
    validePar: valideur,
    valideLe: new Date().toISOString(),
    commentaireValidation: c.commentaire?.trim() || null,
  });
}

export async function depenseEnregistrer(
  tx: BaseSql,
  boutiqueId: string,
  c: ContenuOperation<'DEPENSE_ENREGISTRER'>,
  utilisateurId: string,
) {
  if (c.caisseId) {
    const caisse = await lireCaisse(tx, c.caisseId);
    if (caisse?.statut !== 'OUVERTE') throw new ErreurOperation('Cette caisse n’est plus ouverte.');
  }
  await ecrireEntite(tx, 'depense', c.id, {
    ...c,
    boutiqueId,
    libelle: c.libelle.trim(),
    dateDepense: new Date(c.dateDepense).toISOString(),
    justificatif: false,
    creeParId: utilisateurId,
  });
}
