import { describe, expect, it } from 'vitest';
import { creerPinLocal, empreintePin, pinCorrect } from './pin-local';

const sel = new Uint8Array(16).fill(7);

describe('PIN local', () => {
  it('reconnaît le bon code et refuse les autres', () => {
    const enregistre = creerPinLocal('2580', sel);
    expect(pinCorrect('2580', enregistre)).toBe(true);
    expect(pinCorrect('2581', enregistre)).toBe(false);
    expect(pinCorrect('', enregistre)).toBe(false);
  });

  it('ne garde jamais le code en clair et dépend du sel', () => {
    const enregistre = creerPinLocal('2580', sel);
    expect(JSON.stringify(enregistre)).not.toContain('2580');
    const autre = creerPinLocal('2580', new Uint8Array(16).fill(8));
    expect(autre.empreinte).not.toBe(enregistre.empreinte);
  });

  it('respecte le nombre d’itérations enregistré', () => {
    const enregistre = {
      sel: '00'.repeat(16),
      empreinte: empreintePin('739154', '00'.repeat(16), 10),
      iterations: 10,
    };
    expect(pinCorrect('739154', enregistre)).toBe(true);
  });
});
