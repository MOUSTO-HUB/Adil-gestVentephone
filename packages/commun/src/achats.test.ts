import {
  controlerImeis,
  erreurPaiementAchat,
  erreurReception,
  schemaAchat,
  statutApresReception,
  totalAchat,
} from './achats.js';
import { completerImei } from './imei.js';
import { ecartQuantite, ecartsTelephones } from './inventaire.js';

const ID = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

describe('bon d’achat', () => {
  const achat = {
    id: ID,
    fournisseurId: ID,
    numero: 'MAD-261020-AB12',
    dateAchat: '2026-10-20',
    note: null,
    lignes: [
      { id: ID, produitId: P1, quantite: 3, prixAchat: 1_250_000 },
      { id: P2, produitId: P2, quantite: 10, prixAchat: 15_000 },
    ],
  };

  it('valide un bon et calcule son total', () => {
    expect(schemaAchat.safeParse(achat).success).toBe(true);
    expect(totalAchat(achat.lignes)).toBe(3_900_000);
  });

  it('refuse un bon vide ou un produit en double', () => {
    expect(schemaAchat.safeParse({ ...achat, lignes: [] }).success).toBe(false);
    expect(
      schemaAchat.safeParse({
        ...achat,
        lignes: [achat.lignes[0], { ...achat.lignes[1], produitId: P1 }],
      }).success,
    ).toBe(false);
  });

  it('statut selon la réception', () => {
    expect(statutApresReception([{ quantite: 3, quantiteRecue: 0 }])).toBe('BROUILLON');
    expect(
      statutApresReception([
        { quantite: 3, quantiteRecue: 1 },
        { quantite: 2, quantiteRecue: 2 },
      ]),
    ).toBe('PARTIEL');
    expect(
      statutApresReception([
        { quantite: 3, quantiteRecue: 3 },
        { quantite: 2, quantiteRecue: 2 },
      ]),
    ).toBe('RECU');
  });
});

describe('réception', () => {
  const telephone = { quantite: 3, quantiteRecue: 1, type: 'TELEPHONE' as const, nom: 'Spark 20' };
  const accessoire = { quantite: 10, quantiteRecue: 0, type: 'ACCESSOIRE' as const, nom: 'Coque' };

  it('accepte jusqu’au reste attendu', () => {
    expect(erreurReception(telephone, { articles: [{}, {}] })).toBeNull();
    expect(erreurReception(accessoire, { quantite: 10 })).toBeNull();
  });

  it('refuse plus que commandé, ou le mauvais mode de réception', () => {
    expect(erreurReception(telephone, { articles: [{}, {}, {}] })).toMatch(/3 reçu\(s\) pour 2/);
    expect(erreurReception(telephone, { quantite: 1 })).toMatch(/IMEI/);
    expect(erreurReception(accessoire, { articles: [{}] })).toMatch(/quantité/);
    expect(erreurReception(accessoire, {})).toMatch(/rien/);
  });

  it('contrôle les IMEI saisis en rafale', () => {
    const a = completerImei('35209900000011');
    const b = completerImei('35209900000012');
    const connu = completerImei('35209900000013');
    const r = controlerImeis(
      [a, `${b.slice(0, 7)} ${b.slice(7)}`, a, '123', connu],
      (i) => i === connu,
    );
    expect(r).toEqual({ valides: [a, b], invalides: ['123'], doublons: [a], dejaConnus: [connu] });
  });

  it('un paiement ne dépasse pas le reste dû', () => {
    expect(erreurPaiementAchat(1_000, 400, 600)).toBeNull();
    expect(erreurPaiementAchat(1_000, 400, 601)).toMatch(/dépasse/);
  });
});

describe('inventaire', () => {
  it('écart d’un accessoire', () => {
    expect(ecartQuantite(10, 8)).toBe(-2);
    expect(ecartQuantite(10, 12)).toBe(2);
  });

  it('téléphones manquants, présents et inconnus', () => {
    const stock = [
      { id: 'a', imei: '352099000000011' },
      { id: 'b', imei: '352099000000029' },
    ];
    expect(ecartsTelephones(stock, ['352 0990 0000 0011', '999999999999994'])).toEqual({
      manquants: [stock[1]],
      presents: [stock[0]],
      inconnus: ['999999999999994'],
    });
  });
});
