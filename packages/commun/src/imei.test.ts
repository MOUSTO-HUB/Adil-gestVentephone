import { cleLuhn, completerImei, imeiValide, normaliserImei } from './imei.js';

describe('IMEI', () => {
  it('calcule la clé de Luhn', () => {
    // Exemple de la norme 3GPP TS 23.003 : 49015420323751 → clé 8.
    expect(cleLuhn('49015420323751')).toBe(8);
    expect(completerImei('49015420323751')).toBe('490154203237518');
  });

  it('accepte un IMEI valide, même saisi avec espaces ou tirets', () => {
    expect(imeiValide('490154203237518')).toBe(true);
    expect(imeiValide('49-015420-323751-8')).toBe(true);
    expect(imeiValide(' 4901 5420 3237 518 ')).toBe(true);
  });

  it('refuse une clé fausse, une longueur fausse ou des lettres', () => {
    expect(imeiValide('490154203237517')).toBe(false);
    expect(imeiValide('49015420323751')).toBe(false);
    expect(imeiValide('4901542032375188')).toBe(false);
    expect(imeiValide('49015420323751A')).toBe(false);
  });

  it('normalise la saisie', () => {
    expect(normaliserImei('35 209900-176148 1')).toBe('352099001761481');
  });

  it('refuse de compléter autre chose que 14 chiffres', () => {
    expect(() => completerImei('123')).toThrow(RangeError);
  });
});
