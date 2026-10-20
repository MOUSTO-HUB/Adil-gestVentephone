import type { ProduitSync } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { caisseOuverte, lireCaisse, rapportCaisse } from './caisse-session';
import { enregistrerOperation, ErreurOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const VENDEUR = '99999999-9999-4999-8999-999999999999';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

describe('caisse (base locale)', () => {
  let base: BaseSql;
  const coque = uuid();
  const caisseId = uuid();
  const operation = <
    T extends 'CAISSE_OUVRIR' | 'CAISSE_CLOTURER' | 'DEPENSE_ENREGISTRER' | 'VENTE_ENREGISTRER',
  >(
    type: T,
    contenu: unknown,
  ) =>
    enregistrerOperation(
      base,
      {
        type,
        boutiqueId: BOUTIQUE,
        utilisateurId: VENDEUR,
        utilisateurNom: 'Abdoulaye Kaba',
        contenu: contenu as never,
      },
      uuid,
    );

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    const produit: ProduitSync = {
      id: coque,
      type: 'ACCESSOIRE',
      categorieId: 'c',
      marqueId: null,
      modeleId: null,
      nom: 'Coque',
      capacite: null,
      couleur: null,
      etat: 'NEUF',
      codeBarres: null,
      garantieMois: 0,
      prixAchat: 1_000,
      prixDetail: 30_000,
      prixGros: 25_000,
      seuilGros: null,
      archive: false,
      photo: null,
    };
    await ecrireEntite(base, 'produit', coque, produit);
    await ecrireEntite(base, 'stock', 's', {
      id: 's',
      produitId: coque,
      boutiqueId: BOUTIQUE,
      quantite: 10,
      seuilMinimum: 0,
    });
  });

  it('ouverture, vente, dépense puis clôture avec écart expliqué', async () => {
    await operation('CAISSE_OUVRIR', {
      id: caisseId,
      ouverteLe: new Date().toISOString(),
      fondInitial: 50_000,
    });
    await expect(
      operation('CAISSE_OUVRIR', {
        id: uuid(),
        ouverteLe: new Date().toISOString(),
        fondInitial: 0,
      }),
    ).rejects.toThrow(ErreurOperation);
    expect((await caisseOuverte(base, BOUTIQUE, VENDEUR))?.vendeur).toBe('Abdoulaye Kaba');

    await operation('VENTE_ENREGISTRER', {
      id: uuid(),
      numero: 'MAD-1',
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: [
        {
          id: uuid(),
          produitId: coque,
          articleId: null,
          quantite: 2,
          tarif: 'DETAIL',
          prixUnitaire: 30_000,
        },
      ],
      remise: 0,
      paiements: [{ id: uuid(), moyen: 'ESPECES', montant: 100_000, reference: null }],
      autorisationRemise: null,
      caisseId,
    });
    await operation('DEPENSE_ENREGISTRER', {
      id: uuid(),
      dateDepense: new Date().toISOString(),
      categorie: 'TRANSPORT',
      libelle: 'Taxi',
      montant: 5_000,
      moyen: 'ESPECES',
      caisseId,
    });

    // Attendu : 50 000 + 60 000 − 5 000 = 105 000 en espèces.
    const cloture = (especes: number, commentaire: string | null) =>
      operation('CAISSE_CLOTURER', {
        caisseId,
        clotureeLe: new Date().toISOString(),
        comptage: { ESPECES: especes, ORANGE_MONEY: 0, MTN_MOMO: 0, VIREMENT: 0 },
        commentaire,
      });
    await expect(cloture(104_000, null)).rejects.toThrow(/expliquez/);
    await cloture(104_000, 'Pièce manquante');
    const caisse = await lireCaisse(base, caisseId);
    expect(caisse).toMatchObject({ statut: 'CLOTUREE', ecart: -1_000 });
    expect(caisse?.theorique?.ESPECES).toBe(105_000);
    expect(await caisseOuverte(base, BOUTIQUE, VENDEUR)).toBeNull();

    const rapport = await rapportCaisse(base, caisse!, {
      commerce: 'Adil Phone',
      boutique: 'Madina',
      monnaie: 'GNF',
      fuseau: 'Africa/Conakry',
    });
    expect(rapport).toMatchObject({ nombreVentes: 1, ecartTotal: -1_000 });
    expect(rapport.encaisse.ESPECES).toBe(60_000);
  });
});
