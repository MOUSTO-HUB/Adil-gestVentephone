import { formaterMontant, schemaMontant } from './monnaie.js';

describe('formaterMontant', () => {
  it('sépare les milliers et ajoute la monnaie par défaut', () => {
    expect(formaterMontant(1500000)).toBe('1\u202f500\u202f000 GNF');
  });

  it('accepte une autre monnaie, zéro et les montants négatifs', () => {
    expect(formaterMontant(0, 'FCFA')).toBe('0 FCFA');
    expect(formaterMontant(-2500)).toBe('-2\u202f500 GNF');
  });

  it('refuse un montant non entier', () => {
    expect(() => formaterMontant(10.5)).toThrow(RangeError);
  });
});

describe('schemaMontant', () => {
  it('accepte les entiers positifs et refuse le reste', () => {
    expect(schemaMontant.safeParse(250000).success).toBe(true);
    expect(schemaMontant.safeParse(-1).success).toBe(false);
    expect(schemaMontant.safeParse(12.5).success).toBe(false);
  });
});
