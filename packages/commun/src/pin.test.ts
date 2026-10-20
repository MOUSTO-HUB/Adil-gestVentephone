import { apresEssaiPin, erreurNouveauPin, ETAT_PIN_INITIAL, PIN_ESSAIS_MAX } from './pin.js';

describe('erreurNouveauPin', () => {
  it('accepte 4 à 6 chiffres non triviaux', () => {
    expect(erreurNouveauPin('2580')).toBeNull();
    expect(erreurNouveauPin('739154')).toBeNull();
    expect(erreurNouveauPin('1357')).toBeNull();
  });

  it('refuse une mauvaise longueur ou des lettres', () => {
    expect(erreurNouveauPin('123')).toMatch(/de 4 à 6 chiffres/);
    expect(erreurNouveauPin('1234567')).toMatch(/de 4 à 6 chiffres/);
    expect(erreurNouveauPin('12a4')).toMatch(/de 4 à 6 chiffres/);
  });

  it('refuse les chiffres identiques ou qui se suivent', () => {
    for (const pin of ['0000', '111111', '1234', '456789', '9876', '3210']) {
      expect(erreurNouveauPin(pin)).toMatch(/trop facile/);
    }
  });
});

describe('apresEssaiPin', () => {
  it('décompte les essais et bloque au dernier', () => {
    let etat = ETAT_PIN_INITIAL;
    for (let i = 1; i < PIN_ESSAIS_MAX; i++) {
      etat = apresEssaiPin(etat, false);
      expect(etat).toEqual({ essaisRestants: PIN_ESSAIS_MAX - i, bloque: false });
    }
    etat = apresEssaiPin(etat, false);
    expect(etat).toEqual({ essaisRestants: 0, bloque: true });
  });

  it('un bon code remet le compteur à zéro', () => {
    const etat = apresEssaiPin(apresEssaiPin(ETAT_PIN_INITIAL, false), true);
    expect(etat).toEqual(ETAT_PIN_INITIAL);
  });

  it('une fois bloqué, même un bon code ne débloque pas', () => {
    const bloque = { essaisRestants: 0, bloque: true };
    expect(apresEssaiPin(bloque, true)).toEqual(bloque);
  });
});
