import { describe, expect, it } from 'vitest';
import {
  clePeriode,
  libellePeriode,
  rapportHtml,
  rapportStock,
  rapportVentes,
  type RetourRapport,
  type VenteRapport,
} from './rapports.js';

const FUSEAU = 'Africa/Conakry';

const ventes: VenteRapport[] = [
  // Lundi 19 : téléphone 1 500 000 (coût 1 200 000) + 2 coques 30 000 (coût 10 000), remise 60 000.
  {
    date: '2026-10-19T10:00:00.000Z',
    vendeurId: 'awa',
    sousTotal: 1_560_000,
    remise: 60_000,
    lignes: [
      { produitId: 'tel', quantite: 1, total: 1_500_000, prixAchat: 1_200_000 },
      { produitId: 'coque', quantite: 2, total: 60_000, prixAchat: 10_000 },
    ],
  },
  // Mardi 20 : 3 coques, sans remise.
  {
    date: '2026-10-20T15:00:00.000Z',
    vendeurId: 'ali',
    sousTotal: 90_000,
    remise: 0,
    lignes: [{ produitId: 'coque', quantite: 3, total: 90_000, prixAchat: 10_000 }],
  },
];

// Mardi 20 : une coque de la vente de lundi revient en stock, valeur 28 846.
const retours: RetourRapport[] = [
  {
    date: '2026-10-20T16:00:00.000Z',
    vendeurId: 'awa',
    lignes: [
      {
        produitId: 'coque',
        quantite: 1,
        montant: 28_846,
        coutUnitaire: 10_000,
        destination: 'REMISE_EN_STOCK',
      },
    ],
  },
];

describe('périodes', () => {
  it('jour, semaine ISO et mois à l’heure de la boutique', () => {
    expect(clePeriode('2026-10-19T23:30:00.000Z', 'jour', FUSEAU)).toBe('2026-10-19');
    expect(clePeriode('2026-10-19T23:30:00.000Z', 'jour', 'Africa/Lagos')).toBe('2026-10-20');
    expect(clePeriode('2026-10-19T10:00:00.000Z', 'semaine', FUSEAU)).toBe('2026-S43');
    expect(clePeriode('2027-01-01T10:00:00.000Z', 'semaine', FUSEAU)).toBe('2026-S53');
    expect(clePeriode('2026-10-19T10:00:00.000Z', 'mois', FUSEAU)).toBe('2026-10');
    expect(libellePeriode('2026-S43')).toBe('Semaine 43 de 2026');
    expect(libellePeriode('2026-10-19')).toBe('19/10/2026');
    expect(libellePeriode('2026-10')).toBe('10/2026');
  });
});

describe('chiffre d’affaires et bénéfice brut', () => {
  const r = rapportVentes(ventes, retours, 'jour', FUSEAU);

  it('totaux : remise au prorata, retour déduit, coût récupéré', () => {
    // Ventes : 1 500 000 + 90 000 = 1 590 000 ; retours 28 846.
    expect(r.total).toEqual({
      ventes: 1_590_000,
      retours: 28_846,
      chiffreAffaires: 1_561_154,
      cout: 1_200_000 + 20_000 + 30_000 - 10_000,
      benefice: 1_561_154 - 1_240_000,
      nombreVentes: 2,
      quantite: 5,
    });
  });

  it('par jour, par vendeur, par produit (meilleures ventes d’abord)', () => {
    expect(r.parPeriode.map((p) => [p.cle, p.chiffreAffaires])).toEqual([
      ['2026-10-19', 1_500_000],
      ['2026-10-20', 90_000 - 28_846],
    ]);
    expect(r.parVendeur.map((v) => [v.cle, v.nombreVentes, v.chiffreAffaires])).toEqual([
      ['awa', 1, 1_500_000 - 28_846],
      ['ali', 1, 90_000],
    ]);
    expect(r.parProduit[0]).toMatchObject({ cle: 'tel', chiffreAffaires: 1_442_308, quantite: 1 });
    expect(r.parProduit[1]).toMatchObject({ cle: 'coque', quantite: 4 });
  });

  it('rebut : le coût de l’article rendu reste perdu', () => {
    const rebut = rapportVentes(
      ventes,
      [{ ...retours[0]!, lignes: [{ ...retours[0]!.lignes[0]!, destination: 'REBUT' }] }],
      'mois',
      FUSEAU,
    );
    expect(rebut.total.cout).toBe(1_250_000);
    expect(rebut.parPeriode).toHaveLength(1);
  });
});

describe('stock', () => {
  it('valeur du stock et articles sans vente depuis N jours', () => {
    const r = rapportStock(
      [
        {
          produitId: 'a',
          nom: 'Coque',
          quantite: 40,
          valeurAchat: 400_000,
          valeurVente: 1_200_000,
          derniereVente: '2026-10-19T10:00:00.000Z',
        },
        {
          produitId: 'b',
          nom: 'Chargeur',
          quantite: 5,
          valeurAchat: 100_000,
          valeurVente: 175_000,
          derniereVente: '2026-08-01T10:00:00.000Z',
        },
        {
          produitId: 'c',
          nom: 'Écouteurs',
          quantite: 3,
          valeurAchat: 90_000,
          valeurVente: 150_000,
          derniereVente: null,
        },
        {
          produitId: 'd',
          nom: 'Épuisé',
          quantite: 0,
          valeurAchat: 0,
          valeurVente: 0,
          derniereVente: null,
        },
      ],
      30,
      new Date('2026-10-20T12:00:00.000Z'),
    );
    expect(r).toMatchObject({ quantite: 48, valeurAchat: 590_000, valeurVente: 1_525_000 });
    expect(r.sansVente.map((p) => p.nom)).toEqual(['Écouteurs', 'Chargeur']);
  });
});

describe('rapport imprimable', () => {
  it('tableaux échappés, section vide signalée', () => {
    const html = rapportHtml('Ventes', 'Du 1er au 20 octobre', [
      {
        titre: 'Par produit',
        colonnes: ['Produit', 'CA'],
        lignes: [['Coque <b>', '30 000 GNF']],
        aDroite: [1],
      },
      { titre: 'Par vendeur', colonnes: ['Vendeur'], lignes: [] },
    ]);
    expect(html).toContain('Coque &lt;b&gt;');
    expect(html).toContain('<td class="n">30 000 GNF</td>');
    expect(html).toContain('Aucune donnée.');
  });
});
