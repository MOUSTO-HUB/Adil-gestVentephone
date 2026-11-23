import { describe, expect, it } from 'vitest';
import {
  adresseOtpauth,
  chiffrerSecret,
  codeTotp,
  dechiffrerSecret,
  depuisBase32,
  nouveauSecret,
  pasDe,
  verifierTotp,
  versBase32,
} from './totp.js';

// Secret de la RFC 6238 (SHA1) : « 12345678901234567890 ».
const SECRET_RFC = versBase32(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('vecteurs de test officiels (6 derniers chiffres)', () => {
    expect(codeTotp(SECRET_RFC, pasDe(59_000))).toBe('287082');
    expect(codeTotp(SECRET_RFC, pasDe(1_111_111_109_000))).toBe('081804');
    expect(codeTotp(SECRET_RFC, pasDe(1_234_567_890_000))).toBe('005924');
    expect(codeTotp(SECRET_RFC, pasDe(2_000_000_000_000))).toBe('279037');
  });

  it('base32 aller-retour', () => {
    const octets = Buffer.from('Bonjour Adil Phone');
    expect(depuisBase32(versBase32(octets))).toEqual(octets);
    expect(nouveauSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepte un pas d’écart, refuse plus et refuse un code déjà utilisé', () => {
    const instant = 1_700_000_000_000;
    const pas = pasDe(instant);
    const code = codeTotp(SECRET_RFC, pas);
    expect(verifierTotp(SECRET_RFC, code, null, instant)).toBe(pas);
    expect(verifierTotp(SECRET_RFC, code, null, instant + 30_000)).toBe(pas);
    expect(verifierTotp(SECRET_RFC, code, null, instant + 90_000)).toBeNull();
    expect(verifierTotp(SECRET_RFC, code, pas, instant)).toBeNull();
    expect(verifierTotp(SECRET_RFC, ` ${code.slice(0, 3)} ${code.slice(3)} `, null, instant)).toBe(
      pas,
    );
    expect(verifierTotp(SECRET_RFC, '12345', null, instant)).toBeNull();
  });

  it('chiffre le secret en base', () => {
    const secret = nouveauSecret();
    const chiffre = chiffrerSecret(secret, 'cle-maitre-de-test-assez-longue-0123456789');
    expect(chiffre).not.toContain(secret);
    expect(dechiffrerSecret(chiffre, 'cle-maitre-de-test-assez-longue-0123456789')).toBe(secret);
    expect(() => dechiffrerSecret(chiffre, 'autre-cle-maitre-de-test-0123456789-abcdef')).toThrow();
  });

  it('adresse otpauth lue par Google Authenticator', () => {
    expect(adresseOtpauth('ABC', 'moussa', 'Gestion vente Phone')).toBe(
      'otpauth://totp/Gestion%20vente%20Phone%3Amoussa?secret=ABC&issuer=Gestion+vente+Phone&algorithm=SHA1&digits=6&period=30',
    );
  });
});
