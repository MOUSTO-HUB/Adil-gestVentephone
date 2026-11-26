import { p256 } from '@noble/curves/nist.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { appeler } from './api';

/**
 * Clé de l'appareil (ECDSA P-256) : créée une fois sur l'appareil, elle ne le quitte
 * jamais. À chaque connexion, l'appareil signe un défi du serveur ; le serveur reconnaît
 * ainsi l'appareil en plus de l'identifiant et du mot de passe.
 *
 * - Navigateur (ordinateur, application installée) : clé WebCrypto non exportable,
 *   gardée dans IndexedDB (même un script ne peut pas la lire, seulement s'en servir).
 * - Téléphone et tablette (application native) : clé gardée dans le coffre sécurisé
 *   (Keychain iOS, Keystore Android).
 *
 * Effacer les données du site ou désinstaller l'application efface la clé : l'appareil
 * doit alors être autorisé à nouveau (code d'autorisation).
 */

export interface ClePubliqueJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface PreuveAppareil {
  cle: ClePubliqueJwk;
  defi: string;
  signature: string;
}

const WEB = Platform.OS === 'web';
const BASE = 'gestvente-appareil';
const MAGASIN = 'cles';
const CLE_NATIVE = 'gestvente.cle-appareil';

// ---------------------------------------------------------------- outils base64url

function versBase64Url(octets: Uint8Array): string {
  let binaire = '';
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function depuisHex(hex: string): Uint8Array {
  const octets = new Uint8Array(hex.length / 2);
  for (let i = 0; i < octets.length; i++) octets[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return octets;
}

const versHex = (octets: Uint8Array) =>
  Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- navigateur

interface CleWeb {
  privee: CryptoKey;
  publique: ClePubliqueJwk;
}

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(BASE, 1);
    demande.onupgradeneeded = () => demande.result.createObjectStore(MAGASIN);
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () =>
      rejeter(demande.error ?? new Error('Stockage de l’appareil indisponible.'));
  });
}

async function operation<T>(
  mode: IDBTransactionMode,
  action: (m: IDBObjectStore) => IDBRequest<T>,
) {
  const base = await ouvrirBase();
  try {
    return await new Promise<T>((resoudre, rejeter) => {
      const demande = action(base.transaction(MAGASIN, mode).objectStore(MAGASIN));
      demande.onsuccess = () => resoudre(demande.result);
      demande.onerror = () =>
        rejeter(demande.error ?? new Error('Stockage de l’appareil indisponible.'));
    });
  } finally {
    base.close();
  }
}

let cleWeb: Promise<CleWeb> | null = null;

function cleDuNavigateur(): Promise<CleWeb> {
  cleWeb ??= (async () => {
    if (!globalThis.crypto?.subtle || typeof indexedDB === 'undefined') {
      throw new Error(
        'Ce navigateur ne permet pas de reconnaître l’appareil. Utilisez Chrome, Edge, Firefox ou Safari à jour (pas de navigation privée).',
      );
    }
    const existante = await operation<CleWeb | undefined>('readonly', (m) => m.get('appareil'));
    if (existante?.privee && existante.publique) return existante;
    const paire = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', paire.publicKey);
    const nouvelle: CleWeb = {
      privee: paire.privateKey,
      publique: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! },
    };
    await operation('readwrite', (m) => m.put(nouvelle, 'appareil'));
    return nouvelle;
  })().catch((e: unknown) => {
    cleWeb = null;
    throw e;
  });
  return cleWeb;
}

async function signerWeb(
  message: string,
): Promise<{ publique: ClePubliqueJwk; signature: string }> {
  const cle = await cleDuNavigateur();
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cle.privee,
    new TextEncoder().encode(message),
  );
  return { publique: cle.publique, signature: versBase64Url(new Uint8Array(signature)) };
}

// ---------------------------------------------------------------- téléphone

async function secretNatif(): Promise<Uint8Array> {
  const garde = await SecureStore.getItemAsync(CLE_NATIVE);
  if (garde) return depuisHex(garde);
  const secret = p256.utils.randomSecretKey(Crypto.getRandomBytes(48));
  await SecureStore.setItemAsync(CLE_NATIVE, versHex(secret), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return secret;
}

async function signerNatif(message: string) {
  const secret = await secretNatif();
  const point = p256.getPublicKey(secret, false); // 0x04 ‖ x ‖ y
  const signature = p256.sign(new TextEncoder().encode(message), secret, {
    prehash: true,
    format: 'compact',
  });
  return {
    publique: {
      kty: 'EC' as const,
      crv: 'P-256' as const,
      x: versBase64Url(point.slice(1, 33)),
      y: versBase64Url(point.slice(33, 65)),
    },
    signature: versBase64Url(signature),
  };
}

// ---------------------------------------------------------------- preuve

/** Défi du serveur signé par la clé de cet appareil (à joindre à la connexion). */
export async function preuveAppareil(): Promise<PreuveAppareil> {
  const { defi } = await appeler<{ defi: string }>('/auth/defi', { methode: 'POST' });
  const { publique, signature } = WEB ? await signerWeb(defi) : await signerNatif(defi);
  return { cle: publique, defi, signature };
}

/** Empreinte courte de la clé de cet appareil (affichée pour le reconnaître dans les listes). */
export async function empreinteAppareil(): Promise<string> {
  const { publique } = WEB ? await signerWeb('empreinte') : await signerNatif('empreinte');
  const octets = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new TextEncoder().encode(`${publique.crv}.${publique.x}.${publique.y}`),
  );
  return versBase64Url(new Uint8Array(octets)).slice(0, 8);
}

/** Codes d'erreur de l'API liés à l'appareil. */
export const REFUS_APPAREIL = {
  nonAutorise: 'APPAREIL_NON_AUTORISE',
  codeInvalide: 'CODE_APPAREIL_INVALIDE',
  preuve: 'APPAREIL_PREUVE_ABSENTE',
} as const;

/** L'appareil doit être autorisé par un code (connexion refusée pour cette raison). */
export const codeAppareilDemande = (code: string | undefined) =>
  code === REFUS_APPAREIL.nonAutorise || code === REFUS_APPAREIL.codeInvalide;
