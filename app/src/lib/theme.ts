import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

/**
 * Charte « Gestion vente Phone » : vert sarcelle (confiance, la marque), ambre (l'action
 * de vente), vert, orange et rouge pour les états. Bordures franches : champs,
 * boutons et cartes restent bien visibles, en clair comme en sombre.
 */
const MARQUE = {
  clair: {
    primaire: '#0F766E',
    /** Fond des boutons principaux (texte blanc lisible dans les deux modes). */
    bouton: '#0F766E',
    primaireFonce: '#115E59',
    fondPrimaire: '#E0F2F1',
    accent: '#F59E0B',
    fondAccent: '#FEF3C7',
    succes: '#15803D',
    fondSucces: '#DCFCE7',
    alerte: '#C2410C',
    fondAlerte: '#FFEDD5',
    danger: '#DC2626',
    fondDanger: '#FEE2E2',
    /** Fond des boutons « danger » (texte blanc). */
    boutonDanger: '#DC2626',
    fond: '#EEF2F5',
    carte: '#FFFFFF',
    texte: '#0F172A',
    texteDiscret: '#475569',
    bordure: '#CBD5E1',
    /** Champs de saisie : fond et contour, plus marqués que les cartes. */
    saisie: '#FFFFFF',
    bordureSaisie: '#94A3B8',
    enTete: '#0F766E',
    texteEnTete: '#FFFFFF',
    ombre: '#0F172A',
  },
  sombre: {
    primaire: '#2DD4BF',
    bouton: '#0F766E',
    primaireFonce: '#14B8A6',
    fondPrimaire: '#0F3B38',
    accent: '#FBBF24',
    fondAccent: '#3D2F0E',
    succes: '#4ADE80',
    fondSucces: '#123321',
    alerte: '#FB923C',
    fondAlerte: '#3B2311',
    danger: '#F87171',
    fondDanger: '#3D1717',
    boutonDanger: '#DC2626',
    fond: '#0B1220',
    carte: '#162133',
    texte: '#F1F5F9',
    texteDiscret: '#A3B1C6',
    bordure: '#334155',
    saisie: '#0B1220',
    bordureSaisie: '#64748B',
    enTete: '#115E59',
    texteEnTete: '#FFFFFF',
    ombre: '#000000',
  },
};

export type Couleurs = (typeof MARQUE)['clair'];

/** Thèmes de navigation (fonds d'écran, cartes, texte des composants natifs). */
export const THEME_CLAIR: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: MARQUE.clair.primaire,
    background: MARQUE.clair.fond,
    card: MARQUE.clair.carte,
    text: MARQUE.clair.texte,
    border: MARQUE.clair.bordure,
    notification: MARQUE.clair.danger,
  },
};

export const THEME_SOMBRE: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: MARQUE.sombre.primaire,
    background: MARQUE.sombre.fond,
    card: MARQUE.sombre.carte,
    text: MARQUE.sombre.texte,
    border: MARQUE.sombre.bordure,
    notification: MARQUE.sombre.danger,
  },
};

export type Mode = 'clair' | 'sombre';

/** Mode choisi à la main (bouton ☀️/🌙) ; null : celui de l'appareil. Fourni par `lib/apparence`. */
export const ContexteMode = createContext<Mode | null>(null);

/** Mode affiché : choix de l'utilisateur, sinon réglage clair/sombre de l'appareil. */
export function useMode(): Mode {
  const choisi = useContext(ContexteMode);
  const appareil = useColorScheme();
  return choisi ?? (appareil === 'dark' ? 'sombre' : 'clair');
}

/** Couleurs complètes de la charte, selon le mode clair ou sombre. */
export function useCouleurs(): Couleurs {
  return useMode() === 'sombre' ? MARQUE.sombre : MARQUE.clair;
}

/** Ombre douce des cartes et boutons (iOS, web) ; élévation sur Android. */
export const ombre = (couleur: string, hauteur = 2) => ({
  shadowColor: couleur,
  shadowOpacity: 0.08,
  shadowRadius: hauteur * 4,
  shadowOffset: { width: 0, height: hauteur },
  elevation: hauteur,
});
