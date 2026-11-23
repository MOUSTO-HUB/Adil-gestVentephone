import { describe, expect, it } from 'vitest';
import { PipeEspaces, sansEspaces } from './espaces.pipe.js';

describe('sansEspaces', () => {
  it('retire les espaces autour des chaînes, à toute profondeur', () => {
    expect(
      sansEspaces({
        identifiant: '  adil ',
        motDePasse: ' secret\t',
        lignes: [{ nom: ' Coque ', quantite: 2 }],
        note: null,
      }),
    ).toEqual({
      identifiant: 'adil',
      motDePasse: 'secret',
      lignes: [{ nom: 'Coque', quantite: 2 }],
      note: null,
    });
  });

  it('garde les espaces intérieurs et les valeurs non textuelles', () => {
    expect(sansEspaces(' Adil Phone Madina ')).toBe('Adil Phone Madina');
    const date = new Date();
    expect(sansEspaces(date)).toBe(date);
    expect(sansEspaces(12)).toBe(12);
  });
});

describe('PipeEspaces', () => {
  const pipe = new PipeEspaces();
  it('agit sur le corps et la recherche, pas sur les paramètres de chemin', () => {
    expect(pipe.transform({ a: ' x ' }, { type: 'body' })).toEqual({ a: 'x' });
    expect(pipe.transform({ q: ' x ' }, { type: 'query' })).toEqual({ q: 'x' });
    expect(pipe.transform(' id ', { type: 'param' })).toBe(' id ');
  });
});
