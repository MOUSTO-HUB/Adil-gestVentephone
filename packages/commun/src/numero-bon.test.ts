import { describe, expect, it } from 'vitest';
import { initialesBon, numeroBonCommande, prefixeDuNumero, prochainNumeroBon } from './achats.js';

describe('numéro du bon de commande', () => {
  it('prend les deux premières lettres du nom, sans accent', () => {
    expect(initialesBon('Abdoul')).toBe('AB');
    expect(initialesBon('Élodie Camara')).toBe('EL');
    expect(initialesBon('  ô')).toBe('OX');
  });

  it('écrit BC + initiales + année + ordre sur 4 chiffres', () => {
    expect(numeroBonCommande('Abdoul', 2026, 1)).toBe('BCAB-20260001');
    expect(numeroBonCommande('Abdoul', 2026, 12345)).toBe('BCAB-202612345');
  });

  it('suit le plus grand numéro connu de l’utilisateur et de l’année', () => {
    expect(prochainNumeroBon('Abdoul', 2026, [])).toBe('BCAB-20260001');
    expect(
      prochainNumeroBon('Abdoul', 2026, [
        'BCAB-20260003',
        'BCAB-20250009',
        'BCMA-20260007',
        'MAD-261020-AB12',
      ]),
    ).toBe('BCAB-20260004');
  });

  it('reconnaît le préfixe d’un numéro au nouveau format', () => {
    expect(prefixeDuNumero('BCAB-20260004')).toBe('BCAB-2026');
    expect(prefixeDuNumero('MAD-261020-AB12')).toBeNull();
  });
});
