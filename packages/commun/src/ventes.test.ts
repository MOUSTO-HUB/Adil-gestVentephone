import {
  controlerPaiements,
  erreurRemise,
  finGarantie,
  numeroFacture,
  ordreFacture,
  codeAppareil,
  plafondRemise,
  pourcentageRemise,
  tarifApplicable,
  totauxVente,
} from './ventes.js';

const coque = { prixDetail: 30_000, prixGros: 25_000, seuilGros: 10 };

describe('tarifApplicable', () => {
  it('détail par défaut, gros dès le seuil ou pour un grossiste', () => {
    expect(tarifApplicable(coque, 9, false)).toEqual({ tarif: 'DETAIL', prixUnitaire: 30_000 });
    expect(tarifApplicable(coque, 10, false)).toEqual({ tarif: 'GROS', prixUnitaire: 25_000 });
    expect(tarifApplicable(coque, 1, true)).toEqual({ tarif: 'GROS', prixUnitaire: 25_000 });
    expect(tarifApplicable({ ...coque, seuilGros: null }, 500, false).tarif).toBe('DETAIL');
  });
});

describe('remises', () => {
  const parametres = { remiseMaxVendeur: 5, remiseMaxGerant: 15 };

  it('plafond selon le rôle', () => {
    expect(plafondRemise('VENDEUR', parametres)).toBe(5);
    expect(plafondRemise('GERANT', parametres)).toBe(15);
    expect(plafondRemise('PROPRIETAIRE', parametres)).toBe(100);
  });

  it('dans le plafond : acceptée seule', () => {
    expect(pourcentageRemise(50_000, 1_000_000)).toBe(5);
    expect(erreurRemise(50_000, 1_000_000, 5, null)).toBeNull();
  });

  it('au-delà : validation d’un gérant dont le plafond couvre la remise', () => {
    expect(erreurRemise(100_000, 1_000_000, 5, null)).toMatch(/gérant doit la valider/);
    expect(erreurRemise(100_000, 1_000_000, 5, 15)).toBeNull();
    expect(erreurRemise(200_000, 1_000_000, 5, 15)).toMatch(/au-delà de ce que le gérant/);
    expect(erreurRemise(1_000_001, 1_000_000, 100, null)).toMatch(/dépasse/);
  });

  it('totaux', () => {
    expect(
      totauxVente(
        [
          { quantite: 2, prixUnitaire: 30_000 },
          { quantite: 1, prixUnitaire: 1_500_000 },
        ],
        60_000,
      ),
    ).toEqual({
      sousTotal: 1_560_000,
      remise: 60_000,
      total: 1_500_000,
    });
  });
});

describe('controlerPaiements', () => {
  it('espèces avec rendu de monnaie', () => {
    expect(
      controlerPaiements(85_000, [{ moyen: 'ESPECES', montant: 100_000, reference: null }]),
    ).toEqual({
      ok: true,
      rendu: 15_000,
    });
  });

  it('paiement mixte exact', () => {
    expect(
      controlerPaiements(1_500_000, [
        { moyen: 'ORANGE_MONEY', montant: 1_000_000, reference: 'OM123' },
        { moyen: 'ESPECES', montant: 500_000, reference: null },
      ]),
    ).toEqual({ ok: true, rendu: 0 });
  });

  it('refuse un paiement insuffisant, un rendu hors espèces, une référence manquante', () => {
    expect(
      controlerPaiements(100, [{ moyen: 'ESPECES', montant: 90, reference: null }]),
    ).toMatchObject({
      ok: false,
      motif: expect.stringMatching(/Il manque 10/),
    });
    expect(
      controlerPaiements(100, [{ moyen: 'MTN_MOMO', montant: 120, reference: 'X1' }]),
    ).toMatchObject({
      ok: false,
      motif: expect.stringMatching(/espèces/),
    });
    expect(
      controlerPaiements(100, [{ moyen: 'VIREMENT', montant: 100, reference: ' ' }]),
    ).toMatchObject({
      ok: false,
      motif: expect.stringMatching(/référence/),
    });
  });
});

describe('garantie et numéro de facture', () => {
  it('fin de garantie', () => {
    expect(finGarantie(new Date('2026-10-20T10:00:00Z'), 12)?.toISOString()).toBe(
      '2027-10-20T10:00:00.000Z',
    );
    expect(finGarantie(new Date('2026-10-20T10:00:00Z'), 0)).toBeNull();
  });

  it('numéro unique par appareil', () => {
    expect(numeroFacture('MAD', '3f2a9c1e-0000-4000-8000-000000000000', 42)).toBe(
      'MAD-3F2A9C-000042',
    );
  });
});

describe('numéro d’ordre des factures', () => {
  it('lit le numéro d’ordre en fin de numéro', () => {
    expect(ordreFacture('MAD-3F2A9C-000042')).toBe(42);
    expect(ordreFacture('MAD-3F2A9C-1234567')).toBe(1_234_567);
    expect(ordreFacture('FACTURE-ANCIENNE')).toBeNull();
    expect(codeAppareil('3f2a9c1e-0000-4000-8000-000000000000')).toBe('3F2A9C');
  });
});
