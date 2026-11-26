import { generateKeyPairSync, sign } from 'node:crypto';
import {
  clePublique,
  empreinteCle,
  empreinteCode,
  genererCode,
  normaliserCode,
  signatureValide,
} from './certificats.regles.js';

const paire = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
};
const signer = (privateKey: ReturnType<typeof paire>['privateKey'], message: string) =>
  sign('sha256', Buffer.from(message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );

describe('certification des appareils', () => {
  it('accepte une clé P-256 valable, refuse le reste', () => {
    const { jwk } = paire();
    expect(clePublique({ ...jwk, ext: true, key_ops: ['verify'] })).toEqual(jwk);
    expect(clePublique({ ...jwk, crv: 'P-384' })).toBeNull();
    expect(clePublique({ ...jwk, x: 'court' })).toBeNull();
    expect(clePublique(null)).toBeNull();
  });

  it('donne une empreinte stable propre à chaque clé', () => {
    const a = paire().jwk;
    const b = paire().jwk;
    expect(empreinteCle(clePublique(a)!)).toBe(empreinteCle(clePublique({ ...a })!));
    expect(empreinteCle(clePublique(a)!)).not.toBe(empreinteCle(clePublique(b)!));
  });

  it('vérifie la signature du défi par la bonne clé seulement', () => {
    const a = paire();
    const b = paire();
    const signature = signer(a.privateKey, 'defi-123');
    expect(signatureValide(clePublique(a.jwk)!, 'defi-123', signature)).toBe(true);
    expect(signatureValide(clePublique(a.jwk)!, 'defi-456', signature)).toBe(false);
    expect(signatureValide(clePublique(b.jwk)!, 'defi-123', signature)).toBe(false);
    expect(signatureValide(clePublique(a.jwk)!, 'defi-123', 'abc')).toBe(false);
  });

  it('génère des codes lisibles, reconnus quelle que soit la saisie', () => {
    const code = genererCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(normaliserCode(` ${code.toLowerCase().replace('-', ' ')} `)).toBe(code.replace('-', ''));
    expect(empreinteCode(code.toLowerCase())).toBe(empreinteCode(code));
    expect(new Set(Array.from({ length: 50 }, genererCode)).size).toBe(50);
  });
});
