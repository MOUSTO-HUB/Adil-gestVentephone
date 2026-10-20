import { describe, expect, it } from 'vitest';
import {
  bilanRetour,
  erreurConditionsRetour,
  erreurDestination,
  joursDepuisVente,
  quantiteRetournable,
  valeurRetour,
} from './retours.js';
import { controlerPaiements } from './ventes.js';

const vente = new Date('2026-10-01T10:00:00.000Z');
const jour = (n: number) => new Date(vente.getTime() + n * 86_400_000 + 3_600_000);

describe('conditions de retour', () => {
  const base = {
    dateVente: vente,
    delaiJours: 7,
    etat: 'INTACT' as const,
    type: 'REMBOURSEMENT' as const,
    sousGarantie: true,
  };

  it('dans le délai : retour, avoir ou échange', () => {
    expect(joursDepuisVente(vente, jour(7))).toBe(7);
    expect(erreurConditionsRetour({ ...base, dateRetour: jour(0) })).toBeNull();
    expect(erreurConditionsRetour({ ...base, dateRetour: jour(7), type: 'AVOIR' })).toBeNull();
    expect(erreurConditionsRetour({ ...base, dateRetour: jour(3), etat: 'DEFECTUEUX' })).toBeNull();
  });

  it('appareil endommagé par le client : toujours refusé', () => {
    expect(
      erreurConditionsRetour({ ...base, dateRetour: jour(1), etat: 'ENDOMMAGE', type: 'ECHANGE' }),
    ).toMatch(/endommagé/);
  });

  it('après le délai : seulement l’échange d’un appareil en panne sous garantie', () => {
    const tard = { ...base, dateRetour: jour(30) };
    expect(erreurConditionsRetour(tard)).toMatch(/30 jours \(délai : 7 jours\)/);
    expect(
      erreurConditionsRetour({ ...tard, etat: 'DEFECTUEUX', type: 'REMBOURSEMENT' }),
    ).not.toBeNull();
    expect(erreurConditionsRetour({ ...tard, etat: 'DEFECTUEUX', type: 'ECHANGE' })).toBeNull();
    expect(
      erreurConditionsRetour({ ...tard, etat: 'DEFECTUEUX', type: 'ECHANGE', sousGarantie: false }),
    ).not.toBeNull();
  });

  it('retour daté avant la vente : refusé', () => {
    expect(erreurConditionsRetour({ ...base, dateRetour: jour(-2) })).toMatch(/avant la vente/);
  });
});

describe('valeur rendue et différence', () => {
  it('prix payé, remise déduite au prorata, arrondi comme dans les rapports', () => {
    expect(valeurRetour({ prixUnitaire: 30_000 }, 2, { sousTotal: 60_000, remise: 0 })).toBe(
      60_000,
    );
    // Vente : 1 530 000, remise 120 000 → le téléphone de 1 500 000 vaut 1 382 353.
    expect(
      valeurRetour({ prixUnitaire: 1_500_000 }, 1, { sousTotal: 1_530_000, remise: 120_000 }),
    ).toBe(1_382_353);
    expect(valeurRetour({ prixUnitaire: 100 }, 1, { sousTotal: 0, remise: 0 })).toBe(0);
  });

  it('remboursement et avoir', () => {
    expect(bilanRetour('REMBOURSEMENT', 500_000, 0)).toEqual({
      aRendre: 500_000,
      avoir: 0,
      reprise: 0,
      aPayer: 0,
    });
    expect(bilanRetour('AVOIR', 500_000, 0)).toMatchObject({ aRendre: 0, avoir: 500_000 });
  });

  it('échange plus cher : le client paie la différence', () => {
    const bilan = bilanRetour('ECHANGE', 1_500_000, 1_900_000);
    expect(bilan).toEqual({ aRendre: 0, avoir: 0, reprise: 1_500_000, aPayer: 400_000 });
    expect(
      controlerPaiements(bilan.aPayer, [{ moyen: 'ESPECES', montant: 500_000, reference: null }]),
    ).toEqual({ ok: true, rendu: 100_000 });
  });

  it('échange moins cher : on rend la différence ; prix égal : rien', () => {
    expect(bilanRetour('ECHANGE', 1_500_000, 1_200_000)).toEqual({
      aRendre: 300_000,
      avoir: 0,
      reprise: 1_200_000,
      aPayer: 0,
    });
    expect(bilanRetour('ECHANGE', 1_500_000, 1_500_000)).toMatchObject({ aRendre: 0, aPayer: 0 });
    expect(controlerPaiements(0, [])).toEqual({ ok: true, rendu: 0 });
  });

  it('avoir payé sans référence et sans rendu de monnaie', () => {
    expect(
      controlerPaiements(50_000, [{ moyen: 'AVOIR', montant: 50_000, reference: null }]),
    ).toEqual({
      ok: true,
      rendu: 0,
    });
    expect(
      controlerPaiements(50_000, [{ moyen: 'AVOIR', montant: 60_000, reference: null }]).ok,
    ).toBe(false);
  });
});

describe('destination des articles rendus', () => {
  it('occasion : téléphone avec prix de revente', () => {
    expect(erreurDestination('TELEPHONE', 'OCCASION', 900_000)).toBeNull();
    expect(erreurDestination('TELEPHONE', 'OCCASION', null)).toMatch(/prix de revente/);
    expect(erreurDestination('ACCESSOIRE', 'OCCASION', 10_000)).toMatch(/téléphone/);
    expect(erreurDestination('ACCESSOIRE', 'REBUT', null)).toBeNull();
    expect(erreurDestination('TELEPHONE', 'REMISE_EN_STOCK', 5)).not.toBeNull();
  });

  it('quantité encore retournable', () => {
    expect(quantiteRetournable(5, 2)).toBe(3);
    expect(quantiteRetournable(1, 1)).toBe(0);
  });
});
