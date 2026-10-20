import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Empreinte du code PIN gardée sur l'appareil pour le vérifier hors ligne.
 * PBKDF2-SHA256 salé : assez lent pour décourager les essais, assez rapide pour
 * un smartphone d'entrée de gamme.
 */
export const ITERATIONS_PIN = 20_000;

export interface PinLocal {
  sel: string;
  empreinte: string;
  iterations: number;
}

export function empreintePin(pin: string, sel: string, iterations = ITERATIONS_PIN): string {
  return bytesToHex(
    pbkdf2(sha256, utf8ToBytes(pin), hexToBytes(sel), { c: iterations, dkLen: 32 }),
  );
}

/** `selAleatoire` : 16 octets aléatoires (expo-crypto dans l'application). */
export function creerPinLocal(pin: string, selAleatoire: Uint8Array): PinLocal {
  const sel = bytesToHex(selAleatoire);
  return { sel, empreinte: empreintePin(pin, sel), iterations: ITERATIONS_PIN };
}

export function pinCorrect(pin: string, enregistre: PinLocal): boolean {
  const calcule = empreintePin(pin, enregistre.sel, enregistre.iterations);
  // Comparaison en temps constant.
  let difference = calcule.length ^ enregistre.empreinte.length;
  for (let i = 0; i < calcule.length; i++) {
    difference |= calcule.charCodeAt(i) ^ (enregistre.empreinte.charCodeAt(i) || 0);
  }
  return difference === 0;
}
