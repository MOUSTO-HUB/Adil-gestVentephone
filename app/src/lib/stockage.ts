import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Coffre de l'appareil (Keychain iOS, Keystore Android) pour les jetons et le PIN.
 * Sur le web, il n'existe pas : le stockage du navigateur le remplace (à chiffrer
 * avec la base locale, étape 4).
 */
const surLeWeb = Platform.OS === 'web';

export async function lire<T>(cle: string): Promise<T | null> {
  const valeur = surLeWeb ? localStorage.getItem(cle) : await SecureStore.getItemAsync(cle);
  if (valeur === null) return null;
  try {
    return JSON.parse(valeur) as T;
  } catch {
    return null;
  }
}

export async function ecrire(cle: string, valeur: unknown): Promise<void> {
  const texte = JSON.stringify(valeur);
  if (surLeWeb) localStorage.setItem(cle, texte);
  else await SecureStore.setItemAsync(cle, texte);
}

export async function effacer(...cles: string[]): Promise<void> {
  for (const cle of cles) {
    if (surLeWeb) localStorage.removeItem(cle);
    else await SecureStore.deleteItemAsync(cle);
  }
}

export const CLES = {
  jetons: 'gestvente.jetons',
  profil: 'gestvente.profil',
  pin: 'gestvente.pin',
  etatPin: 'gestvente.etat-pin',
  boutique: 'gestvente.boutique',
  cleBase: 'gestvente.cle-base',
} as const;
