import { describe, expect, it } from 'vitest';
import {
  decalerJour,
  echeancier,
  erreurConditionsCredit,
  erreurFicheCredit,
  erreurPlafondCredit,
  jourLocal,
  repartirEncaissement,
  schemaCreditVente,
  situationCredit,
} from './credit.js';
import { contratCreditHtml, lignesRecuEncaissement } from './documents-credit.js';

describe('échéancier', () => {
  it('tranches égales, la dernière ajustée pour tomber juste', () => {
    const e = echeancier(1_000_000, 3, 'MENSUELLE', '2026-11-15');
    expect(e.map((x) => x.montant)).toEqual([333_333, 333_333, 333_334]);
    expect(e.reduce((t, x) => t + x.montant, 0)).toBe(1_000_000);
    expect(e.map((x) => x.date)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  it('semaine par semaine, et fin de mois respectée chaque mois', () => {
    expect(echeancier(900, 3, 'HEBDOMADAIRE', '2026-12-24').map((x) => x.date)).toEqual([
      '2026-12-24',
      '2026-12-31',
      '2027-01-07',
    ]);
    expect(echeancier(400, 4, 'MENSUELLE', '2027-01-31').map((x) => x.date)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(decalerJour('2028-01-31', 'MENSUELLE', 1)).toBe('2028-02-29');
  });

  it('jour au fuseau du commerce', () => {
    expect(jourLocal(new Date('2026-10-21T23:30:00Z'), 'Africa/Conakry')).toBe('2026-10-21');
    expect(jourLocal(new Date('2026-10-21T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-10-22');
  });
});

describe('conditions du crédit', () => {
  const fiche = {
    nom: 'Binta Diallo',
    telephone: '+224620112233',
    typePiece: 'CNI',
    numeroPiece: 'GN-1',
    adresse: 'Madina, Conakry',
  };

  it('fiche client complète : pièce et adresse', () => {
    expect(erreurFicheCredit(fiche)).toBeNull();
    expect(erreurFicheCredit(null)).toMatch(/fiche/);
    expect(erreurFicheCredit({ ...fiche, adresse: ' ', numeroPiece: null })).toMatch(
      /pièce d’identité, adresse/,
    );
  });

  it('plafond : encours + nouveau crédit ; sans plafond, pas de crédit', () => {
    expect(erreurPlafondCredit(5_000_000, 2_000_000, 3_000_000)).toBeNull();
    expect(erreurPlafondCredit(5_000_000, 2_000_000, 3_000_001)).toMatch(/dépassé/);
    expect(erreurPlafondCredit(null, 0, 1)).toMatch(/propriétaire/);
  });

  it('apport et nombre de tranches', () => {
    expect(erreurConditionsCredit(1_000_000, 200_000, 4)).toBeNull();
    expect(erreurConditionsCredit(1_000_000, 1_000_000, 4)).toMatch(/comptant/);
    expect(erreurConditionsCredit(1_000_000, 0, 53)).toMatch(/1 à 52/);
    expect(erreurConditionsCredit(10, 5, 6)).toMatch(/Trop/);
  });

  it('une tranche par identifiant', () => {
    const credit = {
      id: '11111111-1111-4111-8111-111111111111',
      apport: 0,
      nombreTranches: 2,
      frequence: 'MENSUELLE',
      premiereEcheance: '2026-11-21',
      garantId: null,
      echeanceIds: ['22222222-2222-4222-8222-222222222222'],
    };
    expect(schemaCreditVente.safeParse(credit).success).toBe(false);
    expect(
      schemaCreditVente.safeParse({
        ...credit,
        echeanceIds: [...credit.echeanceIds, '33333333-3333-4333-8333-333333333333'],
      }).success,
    ).toBe(true);
  });
});

describe('encaissements et solde', () => {
  const echeances = [
    { numero: 1, dateEcheance: '2026-10-01', montant: 300, montantPaye: 300, penalite: 0 },
    { numero: 2, dateEcheance: '2026-11-01', montant: 300, montantPaye: 100, penalite: 0 },
    { numero: 3, dateEcheance: '2026-12-01', montant: 400, montantPaye: 0, penalite: 0 },
  ];

  it('un versement solde d’abord la tranche la plus ancienne', () => {
    expect(repartirEncaissement(echeances, 250)).toEqual({
      ok: true,
      parts: [
        { numero: 2, montant: 200 },
        { numero: 3, montant: 50 },
      ],
    });
    expect(repartirEncaissement(echeances, 601)).toEqual({
      ok: false,
      motif: expect.stringMatching(/600/),
    });
  });

  it('retard, montant échu et prochaine tranche', () => {
    expect(situationCredit('EN_COURS', echeances, '2026-11-10')).toMatchObject({
      restant: 600,
      statut: 'EN_RETARD',
      montantEchu: 200,
      joursRetard: 9,
      prochaine: { numero: 2, date: '2026-11-01', reste: 200 },
    });
    expect(situationCredit('EN_COURS', echeances, '2026-10-20').statut).toBe('EN_COURS');
    const solde = echeances.map((e) => ({ ...e, montantPaye: e.montant }));
    expect(situationCredit('SOLDE', solde, '2027-01-01')).toMatchObject({
      restant: 0,
      statut: 'SOLDE',
      prochaine: null,
    });
  });
});

describe('documents du crédit', () => {
  it('reçu de tranche avec le solde restant', () => {
    const lignes = lignesRecuEncaissement(
      {
        commerce: 'Adil Phone',
        boutique: { nom: 'Madina', adresse: null, telephone: null },
        numeroVente: 'MAD-1',
        client: 'Binta Diallo',
        date: '2026-10-21T10:00:00Z',
        montant: 250_000,
        moyen: 'ORANGE_MONEY',
        reference: 'OM123',
        restant: 750_000,
        prochaine: { date: '2026-11-21', reste: 250_000 },
        encaissePar: 'Vendeur',
        monnaie: 'GNF',
        fuseau: 'Africa/Conakry',
      },
      58,
    ).map((l) => l.texte);
    expect(lignes.every((l) => l.length <= 32)).toBe(true);
    expect(lignes.join('\n')).toMatch(/Reste dû +750 000 GNF/);
    expect(lignes.join('\n')).toMatch(/21\/11\/2026/);
  });

  it('contrat avec échéancier et signatures', () => {
    const html = contratCreditHtml({
      commerce: 'Adil Phone',
      boutique: { nom: 'Madina', adresse: 'Marché Madina', telephone: null },
      numeroVente: 'MAD-1',
      dateVente: '2026-10-21T10:00:00Z',
      vendeur: 'Vendeur',
      client: {
        nom: 'Binta <Diallo>',
        telephone: '+224620112233',
        piece: 'CNI GN-1',
        adresse: 'Madina',
      },
      garant: null,
      lignes: [
        { designation: 'iPhone 13', imei: '356987123456780', quantite: 1, total: 4_000_000 },
      ],
      total: 4_000_000,
      apport: 1_000_000,
      montantFinance: 3_000_000,
      frequence: 'MENSUELLE',
      echeances: echeancier(3_000_000, 3, 'MENSUELLE', '2026-11-21'),
      monnaie: 'GNF',
      fuseau: 'Africa/Conakry',
    });
    expect(html).toContain('Binta &lt;Diallo&gt;');
    expect(html).toContain('21/01/2027');
    expect(html).toContain('Le client');
    expect(html).not.toContain('Le garant<br>');
  });
});
