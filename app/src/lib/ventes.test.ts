import { completerImei, type ProduitSync } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { type ArticlePanier, prixDuPanier, prochainNumeroFacture } from './panier';
import { enregistrerOperation, ErreurOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const VENDEUR = '99999999-9999-4999-8999-999999999999';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

const coque = (quantite: number): ArticlePanier => ({
  cle: uuid(),
  produitId: 'coque',
  nom: 'Coque',
  type: 'ACCESSOIRE',
  articleId: null,
  imei: null,
  modeleId: null,
  quantite,
  prixDetail: 30_000,
  prixGros: 25_000,
  seuilGros: 10,
});

describe('panier', () => {
  it('prix de détail, puis de gros dès le seuil atteint sur le produit', () => {
    expect(prixDuPanier([coque(4), coque(5)], false, 0)).toMatchObject({
      sousTotal: 270_000,
      total: 270_000,
    });
    const gros = prixDuPanier([coque(4), coque(6)], false, 0);
    expect(gros.lignes.map((l) => l.tarif)).toEqual(['GROS', 'GROS']);
    expect(gros.sousTotal).toBe(250_000);
  });

  it('client grossiste et remise', () => {
    expect(prixDuPanier([coque(1)], true, 5_000)).toMatchObject({
      sousTotal: 25_000,
      remise: 5_000,
      total: 20_000,
    });
  });

  it('numéros de facture successifs propres à l’appareil', async () => {
    const base = baseEnMemoire();
    await migrer(base);
    const appareil = '3f2a9c1e-0000-4000-8000-000000000000';
    expect(await prochainNumeroFacture(base, 'MAD', appareil)).toBe('MAD-3F2A9C-000001');
    expect(await prochainNumeroFacture(base, 'MAD', appareil)).toBe('MAD-3F2A9C-000002');
    expect(await prochainNumeroFacture(base, 'MAD', 'abcdef12-0000')).toBe('MAD-ABCDEF-000001');
  });
});

describe('vente (base locale)', () => {
  let base: BaseSql;
  const telephone = uuid();
  const accessoire = uuid();
  const articleId = uuid();

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    const produit = (
      id: string,
      type: 'TELEPHONE' | 'ACCESSOIRE',
      garantieMois: number,
    ): ProduitSync => ({
      id,
      type,
      categorieId: 'c',
      marqueId: null,
      modeleId: null,
      nom: type,
      capacite: null,
      couleur: null,
      etat: 'NEUF',
      codeBarres: null,
      garantieMois,
      prixAchat: 1_000,
      prixDetail: 2_000,
      prixGros: 1_800,
      seuilGros: null,
      archive: false,
      photo: null,
    });
    await ecrireEntite(base, 'produit', telephone, produit(telephone, 'TELEPHONE', 12));
    await ecrireEntite(base, 'produit', accessoire, produit(accessoire, 'ACCESSOIRE', 0));
    await ecrireEntite(base, 'article', articleId, {
      id: articleId,
      produitId: telephone,
      boutiqueId: BOUTIQUE,
      imei: completerImei('35209900000041'),
      imei2: null,
      numeroSerie: null,
      statut: 'EN_STOCK',
      origine: 'ACHAT',
      prixAchat: 900,
      prixRevente: null,
    });
    await ecrireEntite(base, 'stock', 's1', {
      id: 's1',
      produitId: telephone,
      boutiqueId: BOUTIQUE,
      quantite: 1,
      seuilMinimum: 0,
    });
    await ecrireEntite(base, 'stock', 's2', {
      id: 's2',
      produitId: accessoire,
      boutiqueId: BOUTIQUE,
      quantite: 5,
      seuilMinimum: 0,
    });
  });

  const vendre = (
    lignes: { produitId: string; articleId: string | null; quantite: number }[],
    paye: number,
    numero = 'MAD-1',
  ) =>
    enregistrerOperation(
      base,
      {
        type: 'VENTE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        utilisateurId: VENDEUR,
        contenu: {
          id: uuid(),
          numero,
          dateVente: '2026-10-20T10:00:00.000Z',
          clientId: null,
          lignes: lignes.map((l) => ({
            ...l,
            id: uuid(),
            tarif: 'DETAIL' as const,
            prixUnitaire: 2_000,
          })),
          remise: 0,
          paiements: [{ id: uuid(), moyen: 'ESPECES' as const, montant: paye, reference: null }],
          autorisationRemise: null,
        },
      },
      uuid,
    );

  it('vend : téléphone vendu, stock diminué, garantie, rendu, vendeur', async () => {
    await vendre(
      [
        { produitId: telephone, articleId, quantite: 1 },
        { produitId: accessoire, articleId: null, quantite: 2 },
      ],
      10_000,
    );
    expect(await base.premier('SELECT statut FROM article WHERE id = ?', [articleId])).toEqual({
      statut: 'VENDU',
    });
    expect(await base.tous('SELECT quantite FROM stock ORDER BY id')).toEqual([
      { quantite: 0 },
      { quantite: 3 },
    ]);
    expect(await base.premier('SELECT total, renduMonnaie, vendeurId FROM vente')).toEqual({
      total: 6_000,
      renduMonnaie: 4_000,
      vendeurId: VENDEUR,
    });
    expect(
      await base.premier('SELECT finGarantie, prixAchat FROM ligneVente WHERE articleId = ?', [
        articleId,
      ]),
    ).toEqual({
      finGarantie: '2027-10-20T10:00:00.000Z',
      prixAchat: 900,
    });
  });

  it('refuse : téléphone déjà vendu, stock insuffisant, paiement insuffisant, numéro en double', async () => {
    await vendre([{ produitId: telephone, articleId, quantite: 1 }], 2_000);
    await expect(
      vendre([{ produitId: telephone, articleId, quantite: 1 }], 2_000, 'MAD-2'),
    ).rejects.toThrow(/déjà été vendu/);
    await expect(
      vendre([{ produitId: accessoire, articleId: null, quantite: 6 }], 12_000, 'MAD-3'),
    ).rejects.toThrow(/5 en stock/);
    await expect(
      vendre([{ produitId: accessoire, articleId: null, quantite: 1 }], 1_000, 'MAD-4'),
    ).rejects.toThrow(ErreurOperation);
    await expect(
      vendre([{ produitId: accessoire, articleId: null, quantite: 1 }], 2_000, 'MAD-1'),
    ).rejects.toThrow(/déjà utilisé/);
  });

  it('annulation : téléphone et accessoires reviennent en stock', async () => {
    const op = await vendre(
      [
        { produitId: telephone, articleId, quantite: 1 },
        { produitId: accessoire, articleId: null, quantite: 2 },
      ],
      6_000,
    );
    const venteId = (op.contenu as { id: string }).id;
    await enregistrerOperation(
      base,
      { type: 'VENTE_ANNULER', boutiqueId: BOUTIQUE, contenu: { venteId, motif: 'Erreur' } },
      uuid,
    );
    expect(await base.premier('SELECT statut FROM article WHERE id = ?', [articleId])).toEqual({
      statut: 'EN_STOCK',
    });
    expect(await base.tous('SELECT quantite FROM stock ORDER BY id')).toEqual([
      { quantite: 1 },
      { quantite: 5 },
    ]);
    expect(await base.premier('SELECT statut, motifAnnulation FROM vente')).toEqual({
      statut: 'ANNULEE',
      motifAnnulation: 'Erreur',
    });
  });
});
