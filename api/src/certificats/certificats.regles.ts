import { createHash, createPublicKey, randomInt, verify } from 'node:crypto';

/**
 * Certification des appareils : chaque appareil garde une clé privée ECDSA P-256 qui ne
 * le quitte jamais ; le serveur connaît la clé publique (JWK) et vérifie la signature
 * d'un défi à chaque connexion.
 */

/** Clé publique transmise par l'appareil (format JWK, courbe P-256). */
export interface ClePublique {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Clé publique propre (champs utiles seulement), ou null si elle n'est pas valable. */
export function clePublique(brute: unknown): ClePublique | null {
  if (!brute || typeof brute !== 'object') return null;
  const { kty, crv, x, y } = brute as Record<string, unknown>;
  if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') {
    return null;
  }
  // Coordonnées de 32 octets : 43 caractères en base64url.
  if (x.length !== 43 || y.length !== 43 || !BASE64URL.test(x) || !BASE64URL.test(y)) return null;
  try {
    createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' });
  } catch {
    return null;
  }
  return { kty, crv, x, y };
}

/** Empreinte stable d'une clé publique (SHA-256, base64url) : identifiant de l'appareil. */
export function empreinteCle(cle: ClePublique): string {
  return createHash('sha256').update(`${cle.crv}.${cle.x}.${cle.y}`).digest('base64url');
}

/** Vérifie la signature ECDSA P-256 / SHA-256 (format brut r‖s de 64 octets, base64url). */
export function signatureValide(cle: ClePublique, message: string, signature: string): boolean {
  if (!BASE64URL.test(signature)) return false;
  const octets = Buffer.from(signature, 'base64url');
  if (octets.length !== 64) return false;
  try {
    return verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key: createPublicKey({ key: { ...cle }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      octets,
    );
  } catch {
    return false;
  }
}

/** Lettres et chiffres sans confusion possible (pas de 0/O, 1/I/L). */
const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Code d'autorisation d'un nouvel appareil : 8 caractères, affiché « ABCD-EFGH ». */
export function genererCode(): string {
  const lettres = Array.from({ length: 8 }, () => ALPHABET_CODE[randomInt(ALPHABET_CODE.length)]);
  return `${lettres.slice(0, 4).join('')}-${lettres.slice(4).join('')}`;
}

/** Code saisi : majuscules, sans espace ni tiret. */
export function normaliserCode(saisie: string): string {
  return saisie.toUpperCase().replace(/[\s-]/g, '');
}

/** Empreinte du code gardée en base (le code lui-même n'est affiché qu'une fois). */
export const empreinteCode = (code: string) =>
  createHash('sha256').update(normaliserCode(code)).digest('hex');

/** Durée de validité d'un code d'autorisation. */
export const VALIDITE_CODE_MS = 24 * 60 * 60 * 1000;

/** Durée de validité d'un défi de connexion. */
export const VALIDITE_DEFI = '3m';
