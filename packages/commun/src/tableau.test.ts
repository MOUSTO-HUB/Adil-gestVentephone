import { describe, expect, it } from 'vitest';
import {
  type ChiffresBoutique,
  evolution,
  periodePrecedente,
  situationTrocs,
  totaliser,
} from './tableau.js';

const boutique = (nom: string, sync: string | null, ca: number): ChiffresBoutique => ({
  boutiqueId: nom,
  nom,
  chiffreAffaires: ca,
  benefice: ca / 10,
  nombreVentes: 2,
  stockAchat: 100,
  stockVente: 150,
  creditsEnCours: 1,
  creditsDu: 50,
  creditsEnRetard: 0,
  creditsEchus: 0,
  depenses: 5,
  ecartsCaisse: -1,
  caissesOuvertes: 1,
  caissesAValider: 0,
  derniereSync: sync,
});

describe('tableau de bord consolidé', () => {
  it('total des boutiques ; la synchronisation la plus ancienne ressort', () => {
    const t = totaliser([
      boutique('A', '2026-10-24T08:00:00Z', 1000),
      boutique('B', '2026-10-23T08:00:00Z', 3000),
    ]);
    expect(t).toMatchObject({
      chiffreAffaires: 4000,
      benefice: 400,
      nombreVentes: 4,
      ecartsCaisse: -2,
    });
    expect(t.derniereSync).toBe('2026-10-23T08:00:00Z');
    expect(
      totaliser([boutique('A', null, 0), boutique('B', '2026-10-23T08:00:00Z', 0)]).derniereSync,
    ).toBeNull();
  });

  it('période précédente de même durée, évolution en %', () => {
    const p = periodePrecedente(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z'));
    expect(p).toEqual({
      du: new Date('2026-09-24T00:00:00Z'),
      au: new Date('2026-10-01T00:00:00Z'),
    });
    expect(evolution(1500, 1000)).toBe(50);
    expect(evolution(500, 1000)).toBe(-50);
    expect(evolution(100, 0)).toBeNull();
    expect(evolution(0, 0)).toBe(0);
  });

  it('situation des trocs : repris, réparés, revendus et marge', () => {
    expect(
      situationTrocs([
        { valeurRetenue: 1_000_000, statutArticle: 'VENDU', repare: false, prixRevente: 1_400_000 },
        { valeurRetenue: 500_000, statutArticle: 'VENDU', repare: true, prixRevente: 800_000 },
        { valeurRetenue: 700_000, statutArticle: 'A_REPARER', repare: false, prixRevente: null },
        { valeurRetenue: 600_000, statutArticle: 'EN_STOCK', repare: true, prixRevente: null },
      ]),
    ).toEqual({
      repris: 4,
      valeurReprise: 2_800_000,
      aReparer: 1,
      repares: 2,
      enVente: 1,
      revendus: 2,
      rebut: 0,
      ventesRevendus: 2_200_000,
      marge: 700_000,
    });
  });
});
