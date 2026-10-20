import type { ProduitSync } from '@gestvente/commun';
import { describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { bornes, rapportStockLocal, rapportVentesLocal } from './rapports';
import { enregistrerOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

describe('périodes des rapports', () => {
  it('jour, 7 jours, ce mois, mois dernier', () => {
    const maintenant = new Date(2026, 9, 20, 15, 30);
    expect(bornes('jour', maintenant)).toEqual({
      du: new Date(2026, 9, 20),
      au: new Date(2026, 9, 21),
    });
    expect(bornes('semaine', maintenant).du).toEqual(new Date(2026, 9, 14));
    expect(bornes('mois', maintenant).du).toEqual(new Date(2026, 9, 1));
    expect(bornes('mois-dernier', maintenant)).toEqual({
      du: new Date(2026, 8, 1),
      au: new Date(2026, 9, 1),
    });
  });
});

describe('rapports hors ligne', () => {
  it('ventes du jour et valeur du stock d’après la base de l’appareil', async () => {
    const base = baseEnMemoire();
    await migrer(base);
    const coque = uuid();
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
      prixAchat: 10_000,
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
    await enregistrerOperation(
      base,
      {
        type: 'VENTE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        utilisateurId: 'vendeur',
        contenu: {
          id: uuid(),
          numero: 'MAD-1',
          dateVente: new Date().toISOString(),
          clientId: null,
          lignes: [
            {
              id: uuid(),
              produitId: coque,
              articleId: null,
              quantite: 3,
              tarif: 'DETAIL',
              prixUnitaire: 30_000,
            },
          ],
          remise: 9_000,
          paiements: [{ id: uuid(), moyen: 'ESPECES', montant: 81_000, reference: null }],
          autorisationRemise: null,
        },
      },
      uuid,
    );
    const ventes = await rapportVentesLocal(
      base,
      BOUTIQUE,
      bornes('jour'),
      'jour',
      'Africa/Conakry',
    );
    expect(ventes.total).toMatchObject({
      chiffreAffaires: 81_000,
      cout: 30_000,
      benefice: 51_000,
      nombreVentes: 1,
    });
    expect(ventes.parProduit[0]).toMatchObject({ libelle: 'Coque', quantite: 3 });

    const stock = await rapportStockLocal(base, BOUTIQUE, 30);
    expect(stock).toMatchObject({ quantite: 7, valeurAchat: 70_000, valeurVente: 210_000 });
    expect(stock.sansVente).toEqual([]);
  });
});
