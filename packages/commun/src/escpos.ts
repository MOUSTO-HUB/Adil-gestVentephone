import type { LigneRecu } from './documents.js';

/**
 * Commandes ESC/POS d'un reçu pour imprimante thermique (Bluetooth) : texte en
 * page de code PC850 (accents français), alignement, gras, avance et coupe du papier.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Page de code PC850 (ESC t 2), reconnue par la quasi-totalité des imprimantes. */
// prettier-ignore
const PC850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a,
  ï: 0x8b, î: 0x8c, Ä: 0x8e, É: 0x90, ô: 0x93, ö: 0x94, û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99,
  Ü: 0x9a, '×': 0x9e, á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, '«': 0xae,
  '»': 0xaf, Á: 0xb5, Â: 0xb6, À: 0xb7, Ê: 0xd2, Ë: 0xd3, È: 0xd4, Í: 0xd6, Î: 0xd7, Ï: 0xd8,
  Ó: 0xe0, Ô: 0xe2, Ú: 0xe9, Û: 0xea, Ù: 0xeb, '°': 0xf8, '·': 0xfa,
};

// prettier-ignore
const REMPLACEMENTS: Record<string, string> = {
  '\u00a0': ' ', '\u202f': ' ', '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-',
  '−': '-', '…': '...', Œ: 'OE', œ: 'oe', '€': 'EUR',
};

/** Texte en octets PC850 ; un caractère inconnu perd son accent, sinon devient « ? ». */
export function encoderPc850(texte: string): number[] {
  const octets: number[] = [];
  for (const brut of texte) {
    for (const c of REMPLACEMENTS[brut] ?? brut) {
      const code = c.charCodeAt(0);
      if (code >= 0x20 && code < 0x7f) octets.push(code);
      else if (PC850[c] !== undefined) octets.push(PC850[c]);
      else {
        const sansAccent = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
        const base = sansAccent.charCodeAt(0);
        octets.push(sansAccent.length && base >= 0x20 && base < 0x7f ? base : 0x3f);
      }
    }
  }
  return octets;
}

export function recuEscPos(lignes: LigneRecu[]): Uint8Array {
  const octets: number[] = [ESC, 0x40, ESC, 0x74, 2];
  let centre = false;
  let gras = false;
  for (const l of lignes) {
    if (!!l.centre !== centre) {
      centre = !!l.centre;
      octets.push(ESC, 0x61, centre ? 1 : 0);
    }
    if (!!l.gras !== gras) {
      gras = !!l.gras;
      octets.push(ESC, 0x45, gras ? 1 : 0);
    }
    octets.push(...encoderPc850(l.texte), LF);
  }
  // Retour aux réglages par défaut, avance de 4 lignes puis coupe partielle (ignorée sans massicot).
  octets.push(ESC, 0x61, 0, ESC, 0x45, 0, ESC, 0x64, 4, GS, 0x56, 66, 0);
  return Uint8Array.from(octets);
}

/** Découpe pour l'envoi Bluetooth (taille de paquet limitée par le MTU). */
export function paquets(octets: Uint8Array, taille: number): Uint8Array[] {
  const resultat: Uint8Array[] = [];
  for (let i = 0; i < octets.length; i += taille) resultat.push(octets.subarray(i, i + taille));
  return resultat;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 sans dépendance (le Bluetooth attend des valeurs en base64). */
export function versBase64(octets: Uint8Array): string {
  let s = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i] ?? 0;
    const b = octets[i + 1];
    const c = octets[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    s += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!;
    s += c === undefined ? '=' : ALPHABET[n & 63]!;
  }
  return s;
}
