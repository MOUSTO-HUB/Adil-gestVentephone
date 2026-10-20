import { completerImei } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { enregistrerOperation, ErreurOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

describe('achats et inventaire (base locale)', () => {
  let base: BaseSql;
  const telephone = uuid();
  const coque = uuid();
  const fournisseur = uuid();
  const achatId = uuid();
  const ligneTel = uuid();
  const ligneCoque = uuid();
  const op = (type: Parameters<typeof enregistrerOperation>[1]['type'], contenu: unknown) =>
    enregistrerOperation(base, { type, boutiqueId: BOUTIQUE, contenu } as never, uuid);
  const quantite = async (produitId: string) =>
    (
      await base.premier<{ quantite: number }>('SELECT quantite FROM stock WHERE produitId = ?', [
        produitId,
      ])
    )?.quantite ?? 0;
  const dette = async () =>
    (
      await base.premier<{ dette: number }>('SELECT dette FROM fournisseur WHERE id = ?', [
        fournisseur,
      ])
    )?.dette;

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    const produit = {
      categorieId: 'c',
      marqueId: null,
      modeleId: null,
      capacite: null,
      couleur: null,
      etat: 'NEUF' as const,
      codeBarres: null,
      garantieMois: 0,
      prixAchat: 1,
      prixDetail: 2,
      prixGros: 2,
      seuilGros: null,
      archive: false,
      photo: null,
    };
    await ecrireEntite(base, 'produit', telephone, {
      ...produit,
      id: telephone,
      type: 'TELEPHONE',
      nom: 'Spark 20',
    });
    await ecrireEntite(base, 'produit', coque, {
      ...produit,
      id: coque,
      type: 'ACCESSOIRE',
      nom: 'Coque',
    });
    await ecrireEntite(base, 'fournisseur', fournisseur, {
      id: fournisseur,
      nom: 'Madina',
      telephone: null,
      adresse: null,
      note: null,
      archive: false,
      dette: 0,
    });
    await op('ACHAT_ENREGISTRER', {
      id: achatId,
      fournisseurId: fournisseur,
      numero: 'MAD-1',
      dateAchat: '2026-10-20',
      note: null,
      lignes: [
        { id: ligneTel, produitId: telephone, quantite: 2, prixAchat: 1_000_000 },
        { id: ligneCoque, produitId: coque, quantite: 10, prixAchat: 15_000 },
      ],
    });
  });

  it('un bon augmente la dette du fournisseur ; un paiement la réduit', async () => {
    expect(await dette()).toBe(2_150_000);
    await op('ACHAT_PAYER', { achatId, montant: 150_000 });
    expect(await dette()).toBe(2_000_000);
    await expect(op('ACHAT_PAYER', { achatId, montant: 2_000_001 })).rejects.toThrow(/dépasse/);
  });

  it('réception : téléphones créés, stock augmenté, statut du bon', async () => {
    const articleId = uuid();
    await op('ACHAT_RECEVOIR', {
      achatId,
      lignes: [
        { ligneId: ligneTel, articles: [{ id: articleId, imei: completerImei('35209900000021') }] },
        { ligneId: ligneCoque, quantite: 10 },
      ],
    });
    expect(await base.premier('SELECT statut FROM article WHERE id = ?', [articleId])).toEqual({
      statut: 'EN_STOCK',
    });
    expect(await quantite(telephone)).toBe(1);
    expect(await quantite(coque)).toBe(10);
    expect(await base.premier('SELECT statut FROM achat WHERE id = ?', [achatId])).toEqual({
      statut: 'PARTIEL',
    });
    // Bon reçu en partie : ni modification, ni annulation ; IMEI déjà en stock refusé.
    await expect(op('ACHAT_ANNULER', { achatId })).rejects.toThrow(/déjà été reçus/);
    await expect(
      op('ACHAT_RECEVOIR', {
        achatId,
        lignes: [
          { ligneId: ligneTel, articles: [{ id: uuid(), imei: completerImei('35209900000021') }] },
        ],
      }),
    ).rejects.toThrow(ErreurOperation);
  });

  it('annuler un brouillon retire sa dette', async () => {
    await op('ACHAT_ANNULER', { achatId });
    expect(await base.premier('SELECT statut FROM achat WHERE id = ?', [achatId])).toEqual({
      statut: 'ANNULE',
    });
    expect(await dette()).toBe(0);
  });

  it('inventaire : quantité comptée et téléphones manquants', async () => {
    const a = uuid();
    const b = uuid();
    await op('ACHAT_RECEVOIR', {
      achatId,
      lignes: [
        {
          ligneId: ligneTel,
          articles: [
            { id: a, imei: completerImei('35209900000031') },
            { id: b, imei: completerImei('35209900000032') },
          ],
        },
        { ligneId: ligneCoque, quantite: 10 },
      ],
    });
    await op('INVENTAIRE_VALIDER', {
      id: uuid(),
      motif: 'Fin de mois',
      lignes: [
        { produitId: coque, quantiteComptee: 7 },
        { produitId: telephone, imeis: [completerImei('35209900000031')] },
      ],
    });
    expect(await quantite(coque)).toBe(7);
    expect(await quantite(telephone)).toBe(1);
    expect(await base.premier('SELECT statut FROM article WHERE id = ?', [b])).toEqual({
      statut: 'REBUT',
    });
  });

  it('seuil d’alerte du stock', async () => {
    await op('STOCK_SEUIL', { produitId: coque, seuilMinimum: 4 });
    expect(
      await base.premier('SELECT seuilMinimum FROM stock WHERE produitId = ?', [coque]),
    ).toEqual({ seuilMinimum: 4 });
  });
});
