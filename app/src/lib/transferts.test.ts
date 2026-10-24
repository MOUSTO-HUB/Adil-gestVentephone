import { completerImei, type ProduitSync } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { enregistrerOperation } from './sync/operations-locales';
import { detailTransfert, listeTransferts } from './transferts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const MOI = '99999999-9999-4999-8999-999999999999';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

const produit = (id: string, type: 'TELEPHONE' | 'ACCESSOIRE', nom: string): ProduitSync => ({
  id,
  type,
  categorieId: 'c',
  marqueId: null,
  modeleId: null,
  nom,
  capacite: null,
  couleur: null,
  etat: 'NEUF',
  codeBarres: null,
  garantieMois: 0,
  prixAchat: null,
  prixDetail: 1000,
  prixGros: 1000,
  seuilGros: null,
  archive: false,
  photo: null,
});

describe('transferts sur l’appareil (hors ligne)', () => {
  let base: BaseSql;
  const tel = uuid();
  const coque = uuid();
  const article = uuid();
  const imei = completerImei('35209900000222');

  const quantite = async (produitId: string, boutiqueId: string) =>
    (
      await base.premier<{ quantite: number }>(
        'SELECT quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
        [produitId, boutiqueId],
      )
    )?.quantite ?? 0;
  const operation = <T extends 'TRANSFERT_ENVOYER' | 'TRANSFERT_RECEVOIR' | 'TRANSFERT_ANNULER'>(
    type: T,
    boutiqueId: string,
    contenu: unknown,
  ) =>
    enregistrerOperation(
      base,
      { type, boutiqueId, utilisateurId: MOI, contenu: contenu as never },
      uuid,
    );

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    await ecrireEntite(base, 'produit', tel, produit(tel, 'TELEPHONE', 'Itel A70'));
    await ecrireEntite(base, 'produit', coque, produit(coque, 'ACCESSOIRE', 'Coque'));
    await ecrireEntite(base, 'article', article, {
      id: article,
      produitId: tel,
      boutiqueId: A,
      imei,
      imei2: null,
      numeroSerie: null,
      statut: 'EN_STOCK',
      origine: 'ACHAT',
      prixAchat: null,
      prixRevente: null,
    });
    await base.executer(
      "INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES ('s1', ?, ?, 1, 0), ('s2', ?, ?, 20, 0)",
      [tel, A, coque, A],
    );
  });

  const envoyer = (id: string, lignes: object[]) =>
    operation('TRANSFERT_ENVOYER', A, {
      id,
      numero: 'TR-261024-AAAA',
      boutiqueArriveeId: B,
      note: null,
      lignes,
    });

  it('envoi puis réception partielle : le stock d’arrivée ne monte qu’à la confirmation', async () => {
    const id = uuid();
    const ligneCoque = uuid();
    await envoyer(id, [
      { id: uuid(), produitId: tel, articleId: article, quantite: 1 },
      { id: ligneCoque, produitId: coque, articleId: null, quantite: 10 },
    ]);
    expect(await quantite(tel, A)).toBe(0);
    expect(await quantite(coque, A)).toBe(10);
    expect(await quantite(coque, B)).toBe(0);
    expect(await base.premier('SELECT statut FROM article WHERE id = ?', [article])).toEqual({
      statut: 'EN_TRANSFERT',
    });
    expect((await listeTransferts(base, B, 'A_RECEVOIR')).map((t) => t.id)).toEqual([id]);
    const detail = await detailTransfert(base, id);
    expect(detail?.lignes.find((l) => l.articleId)?.imei).toBe(imei);

    await operation('TRANSFERT_RECEVOIR', B, {
      transfertId: id,
      recuLe: new Date().toISOString(),
      quantites: [{ ligneId: ligneCoque, quantite: 9 }],
      articlesRecus: [article],
      note: 'une coque cassée',
    });
    expect(await quantite(coque, B)).toBe(9);
    expect(await quantite(tel, B)).toBe(1);
    expect(
      await base.premier('SELECT statut, boutiqueId FROM article WHERE id = ?', [article]),
    ).toEqual({ statut: 'EN_STOCK', boutiqueId: B });
    expect(await listeTransferts(base, B, 'A_RECEVOIR')).toEqual([]);
  });

  it('annulation d’un envoi : tout revient au départ ; pas plus que le stock', async () => {
    const id = uuid();
    await envoyer(id, [{ id: uuid(), produitId: coque, articleId: null, quantite: 5 }]);
    await operation('TRANSFERT_ANNULER', A, { transfertId: id, motif: 'Erreur' });
    expect(await quantite(coque, A)).toBe(20);
    await expect(
      envoyer(uuid(), [{ id: uuid(), produitId: coque, articleId: null, quantite: 21 }]),
    ).rejects.toThrow(/insuffisant/);
  });
});
