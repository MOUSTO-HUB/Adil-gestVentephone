import { createHash, randomBytes } from 'node:crypto';

export const DUREE_ACCES = '15m';
export const DUREE_RAFRAICHISSEMENT_MS = 30 * 24 * 60 * 60 * 1000;

/** Empreinte stockée en base : jamais le jeton lui-même. */
export const empreinte = (secret: string) => createHash('sha256').update(secret).digest('hex');

/**
 * Jeton de rafraîchissement : « appareilId.secret ». L'identifiant de l'appareil
 * permet de reconnaître un ancien jeton réutilisé (vol probable) et de couper
 * aussitôt la session de cet appareil.
 */
export function creerJetonRafraichissement(appareilId: string): { jeton: string; secret: string } {
  const secret = randomBytes(32).toString('base64url');
  return { jeton: `${appareilId}.${secret}`, secret };
}

export function lireJetonRafraichissement(
  jeton: string,
): { appareilId: string; secret: string } | null {
  const point = jeton.indexOf('.');
  if (point <= 0 || point === jeton.length - 1) return null;
  return { appareilId: jeton.slice(0, point), secret: jeton.slice(point + 1) };
}
