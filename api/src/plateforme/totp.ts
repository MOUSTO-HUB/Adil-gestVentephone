import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Double authentification par application (Google Authenticator, Microsoft Authenticator…) :
 * codes TOTP à 6 chiffres renouvelés toutes les 30 secondes (RFC 6238, HMAC-SHA1).
 */

export const PAS_SECONDES = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648, sans « = ») : format du secret attendu par les applications. */
export function versBase32(octets: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let sortie = '';
  for (const octet of octets) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function depuisBase32(texte: string): Buffer {
  const propre = texte.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('Secret base32 invalide.');
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

/** Nouveau secret : 20 octets aléatoires (160 bits), en base32. */
export function nouveauSecret(): string {
  return versBase32(randomBytes(20));
}

/** Numéro du pas de 30 s pour un instant donné. */
export function pasDe(instant = Date.now()): number {
  return Math.floor(instant / 1000 / PAS_SECONDES);
}

/** Code à 6 chiffres pour un pas donné. */
export function codeTotp(secret: string, pas: number): string {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const hmac = createHmac('sha1', depuisBase32(secret)).update(compteur).digest();
  const decalage = hmac[hmac.length - 1] & 0x0f;
  const nombre = (hmac.readUInt32BE(decalage) & 0x7fffffff) % 1_000_000;
  return String(nombre).padStart(6, '0');
}

/**
 * Vérifie un code (un pas d'avance ou de retard toléré pour l'horloge du téléphone).
 * Rend le pas reconnu, ou null. Un pas déjà utilisé (`dernierPas`) est refusé.
 */
export function verifierTotp(
  secret: string,
  code: string,
  dernierPas: number | null,
  instant = Date.now(),
): number | null {
  const saisi = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(saisi)) return null;
  const actuel = pasDe(instant);
  for (const pas of [actuel - 1, actuel, actuel + 1]) {
    if (dernierPas !== null && pas <= dernierPas) continue;
    if (codeTotp(secret, pas) === saisi) return pas;
  }
  return null;
}

/** Adresse otpauth:// à mettre dans le QR code (lue par l'application d'authentification). */
export function adresseOtpauth(secret: string, identifiant: string, emetteur: string): string {
  const libelle = encodeURIComponent(`${emetteur}:${identifiant}`);
  const params = new URLSearchParams({
    secret,
    issuer: emetteur,
    algorithm: 'SHA1',
    digits: '6',
    period: String(PAS_SECONDES),
  });
  return `otpauth://totp/${libelle}?${params.toString()}`;
}

/** Le secret est chiffré en base (AES-256-GCM, clé dérivée de JWT_SECRET). */
function cle(cleMaitre: string): Buffer {
  return createHash('sha256').update(`totp:${cleMaitre}`).digest();
}

export function chiffrerSecret(secret: string, cleMaitre: string): string {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv('aes-256-gcm', cle(cleMaitre), iv);
  const chiffre = Buffer.concat([chiffreur.update(secret, 'utf8'), chiffreur.final()]);
  return [iv, chiffreur.getAuthTag(), chiffre].map((b) => b.toString('base64url')).join('.');
}

export function dechiffrerSecret(valeur: string, cleMaitre: string): string {
  const [iv, etiquette, chiffre] = valeur.split('.').map((b) => Buffer.from(b, 'base64url'));
  const dechiffreur = createDecipheriv('aes-256-gcm', cle(cleMaitre), iv);
  dechiffreur.setAuthTag(etiquette);
  return Buffer.concat([dechiffreur.update(chiffre), dechiffreur.final()]).toString('utf8');
}
