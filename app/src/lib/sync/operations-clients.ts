import type { ContenuOperation } from '@gestvente/commun';
import { ecrireEntite } from '../base/depot';
import type { BaseSql } from '../base/sql';
import { nomDejaPris } from './doublons';
import { ErreurOperation } from './erreurs';

/** Client et garant sur l'appareil ; le serveur vérifie les droits (plafond, grossiste). */
export async function clientEnregistrer(tx: BaseSql, c: ContenuOperation<'CLIENT_ENREGISTRER'>) {
  const existant = await tx.premier<{ photoPiece: number }>(
    'SELECT photoPiece FROM client WHERE id = ?',
    [c.id],
  );
  const { garant, ...champs } = c;
  await ecrireEntite(tx, 'client', c.id, {
    ...champs,
    numeroPiece: c.numeroPiece || null,
    adresse: c.adresse || null,
    photoPiece: !!existant?.photoPiece,
  });
  await tx.executer('DELETE FROM garant WHERE clientId = ? AND id <> ?', [c.id, garant?.id ?? '']);
  if (garant) {
    await ecrireEntite(tx, 'garant', garant.id, {
      ...garant,
      clientId: c.id,
      numeroPiece: garant.numeroPiece || null,
      adresse: garant.adresse || null,
      lien: garant.lien || null,
    });
  }
}

export async function fournisseurEnregistrer(
  tx: BaseSql,
  c: ContenuOperation<'FOURNISSEUR_ENREGISTRER'>,
) {
  const doublon = await nomDejaPris(tx, 'fournisseur', c.id, c.nom);
  if (doublon) throw new ErreurOperation(`Le fournisseur « ${doublon} » existe déjà.`);
  const existant = await tx.premier<{ dette: number }>(
    'SELECT dette FROM fournisseur WHERE id = ?',
    [c.id],
  );
  await ecrireEntite(tx, 'fournisseur', c.id, {
    ...c,
    adresse: c.adresse || null,
    note: c.note || null,
    dette: existant?.dette ?? 0,
  });
}
