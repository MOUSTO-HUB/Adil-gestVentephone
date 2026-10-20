import { completerImei, type ContenuOperation, type ProduitSync } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { enregistrerOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const GERANT = '99999999-9999-4999-8999-999999999999';
const CLIENT = '88888888-8888-4888-8888-888888888888';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

describe('retours (base locale)', () => {
  let base: BaseSql;
  const telephone = uuid();
  const coque = uuid();
  const articles = [uuid(), uuid()];

  const vendre = async (
    lignes: { produitId: string; articleId: string | null; quantite: number; prix: number }[],
    remise = 0,
  ) => {
    const total = lignes.reduce((t, l) => t + l.quantite * l.prix, 0) - remise;
    const id = uuid();
    await enregistrerOperation(
      base,
      {
        type: 'VENTE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        utilisateurId: GERANT,
        contenu: {
          id,
          numero: `MAD-${compteur}`,
          dateVente: new Date().toISOString(),
          clientId: CLIENT,
          lignes: lignes.map((l) => ({
            id: uuid(),
            produitId: l.produitId,
            articleId: l.articleId,
            quantite: l.quantite,
            tarif: 'DETAIL' as const,
            prixUnitaire: l.prix,
          })),
          remise,
          paiements: [{ id: uuid(), moyen: 'ESPECES' as const, montant: total, reference: null }],
          autorisationRemise: null,
        },
      },
      uuid,
    );
    return {
      id,
      lignes: await base.tous<{ id: string; produitId: string }>(
        'SELECT id, produitId FROM ligneVente WHERE venteId = ?',
        [id],
      ),
    };
  };

  const retourner = (
    venteId: string,
    lignes: ContenuOperation<'RETOUR_ENREGISTRER'>['lignes'],
    surcharge: Partial<ContenuOperation<'RETOUR_ENREGISTRER'>> = {},
  ) =>
    enregistrerOperation(
      base,
      {
        type: 'RETOUR_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        utilisateurId: GERANT,
        contenu: {
          id: uuid(),
          venteId,
          dateRetour: new Date().toISOString(),
          type: 'REMBOURSEMENT',
          etatAppareil: 'INTACT',
          motif: 'Changement d’avis',
          lignes,
          remboursement: { moyen: 'ESPECES', reference: null },
          echange: null,
          autorisation: null,
          ...surcharge,
        },
      },
      uuid,
    );

  const stock = async (produitId: string) =>
    (await base.premier<{ quantite: number }>('SELECT quantite FROM stock WHERE produitId = ?', [
      produitId,
    ]))!.quantite;

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    const produit = (id: string, type: 'TELEPHONE' | 'ACCESSOIRE'): ProduitSync => ({
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
      garantieMois: type === 'TELEPHONE' ? 12 : 0,
      prixAchat: 1_000,
      prixDetail: 2_000,
      prixGros: 1_800,
      seuilGros: null,
      archive: false,
      photo: null,
    });
    await ecrireEntite(base, 'produit', telephone, produit(telephone, 'TELEPHONE'));
    await ecrireEntite(base, 'produit', coque, produit(coque, 'ACCESSOIRE'));
    for (const [i, id] of articles.entries()) {
      await ecrireEntite(base, 'article', id, {
        id,
        produitId: telephone,
        boutiqueId: BOUTIQUE,
        imei: completerImei(`3520990000005${i}`),
        imei2: null,
        numeroSerie: null,
        statut: 'EN_STOCK',
        origine: 'ACHAT',
        prixAchat: 900,
        prixRevente: null,
      });
    }
    await ecrireEntite(base, 'stock', 's1', {
      id: 's1',
      produitId: telephone,
      boutiqueId: BOUTIQUE,
      quantite: 2,
      seuilMinimum: 0,
    });
    await ecrireEntite(base, 'stock', 's2', {
      id: 's2',
      produitId: coque,
      boutiqueId: BOUTIQUE,
      quantite: 10,
      seuilMinimum: 0,
    });
    await ecrireEntite(base, 'client', CLIENT, {
      id: CLIENT,
      nom: 'Aminata',
      telephone: '+224620555444',
      type: 'DETAIL',
      typePiece: null,
      numeroPiece: null,
      adresse: null,
      plafondCredit: null,
      soldeAvoir: 0,
      archive: false,
      photoPiece: false,
    });
  });

  it('remboursement : téléphone revendu d’occasion, coque au rebut, valeur au prorata', async () => {
    const vente = await vendre(
      [
        { produitId: telephone, articleId: articles[0]!, quantite: 1, prix: 2_000 },
        { produitId: coque, articleId: null, quantite: 2, prix: 2_000 },
      ],
      600,
    );
    const ligneTel = vente.lignes.find((l) => l.produitId === telephone)!;
    const ligneCoque = vente.lignes.find((l) => l.produitId === coque)!;
    await retourner(vente.id, [
      {
        id: uuid(),
        ligneVenteId: ligneTel.id,
        quantite: 1,
        destination: 'OCCASION',
        prixRevente: 1_500,
      },
      {
        id: uuid(),
        ligneVenteId: ligneCoque.id,
        quantite: 1,
        destination: 'REBUT',
        prixRevente: null,
      },
    ]);
    // 6 000 − 600 : chaque article perd 10 %.
    expect(await base.premier('SELECT valeur, montantRembourse FROM retour')).toEqual({
      valeur: 3_600,
      montantRembourse: 3_600,
    });
    expect(
      await base.premier('SELECT statut, prixRevente FROM article WHERE id = ?', [articles[0]]),
    ).toEqual({ statut: 'EN_STOCK', prixRevente: 1_500 });
    expect(await stock(telephone)).toBe(2);
    expect(await stock(coque)).toBe(8);
    await expect(
      retourner(vente.id, [
        {
          id: uuid(),
          ligneVenteId: ligneCoque.id,
          quantite: 2,
          destination: 'REBUT',
          prixRevente: null,
        },
      ]),
    ).rejects.toThrow(/1 sur 2 déjà rendu/);
  });

  it('avoir puis paiement par avoir ; échange avec différence payée', async () => {
    const vente = await vendre([{ produitId: coque, articleId: null, quantite: 3, prix: 2_000 }]);
    await retourner(
      vente.id,
      [
        {
          id: uuid(),
          ligneVenteId: vente.lignes[0]!.id,
          quantite: 2,
          destination: 'REMISE_EN_STOCK',
          prixRevente: null,
        },
      ],
      { type: 'AVOIR', remboursement: null },
    );
    expect(await base.premier('SELECT soldeAvoir FROM client')).toEqual({ soldeAvoir: 4_000 });

    const telVendu = await vendre([
      { produitId: telephone, articleId: articles[0]!, quantite: 1, prix: 2_000 },
    ]);
    const echangeId = uuid();
    await retourner(
      telVendu.id,
      [
        {
          id: uuid(),
          ligneVenteId: telVendu.lignes[0]!.id,
          quantite: 1,
          destination: 'REMISE_EN_STOCK',
          prixRevente: null,
        },
      ],
      {
        type: 'ECHANGE',
        remboursement: null,
        echange: {
          id: echangeId,
          numero: 'MAD-ECH-1',
          dateVente: new Date().toISOString(),
          clientId: CLIENT,
          lignes: [
            {
              id: uuid(),
              produitId: telephone,
              articleId: articles[1]!,
              quantite: 1,
              tarif: 'DETAIL',
              prixUnitaire: 2_000,
            },
            {
              id: uuid(),
              produitId: coque,
              articleId: null,
              quantite: 1,
              tarif: 'DETAIL',
              prixUnitaire: 2_000,
            },
          ],
          remise: 0,
          // La différence (2 000) payée par l'avoir du client.
          paiements: [{ id: uuid(), moyen: 'AVOIR', montant: 2_000, reference: null }],
          autorisationRemise: null,
        },
      },
    );
    expect(
      await base.premier('SELECT sousTotal, reprise, total FROM vente WHERE id = ?', [echangeId]),
    ).toEqual({ sousTotal: 4_000, reprise: 2_000, total: 2_000 });
    expect(await base.premier('SELECT soldeAvoir FROM client')).toEqual({ soldeAvoir: 2_000 });
    expect(await base.tous('SELECT statut FROM article ORDER BY id')).toEqual([
      { statut: 'EN_STOCK' },
      { statut: 'VENDU' },
    ]);
  });
});
