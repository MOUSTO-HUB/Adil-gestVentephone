import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { useColorScheme } from 'react-native';

/**
 * Charte « GestVente Phone » : bleu indigo (confiance, la marque), ambre (l'action
 * de vente), vert, orange et rouge pour les états. Clair ou sombre selon l'appareil.
 */
const MARQUE = {
  clair: {
    primaire: '#3949AB',
    /** Fond des boutons principaux (texte blanc lisible dans les deux modes). */
    bouton: '#3949AB',
    primaireFonce: '#283593',
    fondPrimaire: '#E8EAF6',
    accent: '#F59E0B',
    fondAccent: '#FEF3C7',
    succes: '#16A34A',
    fondSucces: '#DCFCE7',
    alerte: '#EA580C',
    fondAlerte: '#FFEDD5',
    danger: '#DC2626',
    fondDanger: '#FEE2E2',
    fond: '#F3F4F8',
    carte: '#FFFFFF',
    texte: '#1E2235',
    texteDiscret: '#6B7088',
    bordure: '#E1E4EE',
    enTete: '#283593',
    texteEnTete: '#FFFFFF',
    ombre: '#1E2235',
  },
  sombre: {
    primaire: '#8C9EFF',
    bouton: '#3F51B5',
    primaireFonce: '#536DFE',
    fondPrimaire: '#232A4D',
    accent: '#FBBF24',
    fondAccent: '#3D2F0E',
    succes: '#4ADE80',
    fondSucces: '#123321',
    alerte: '#FB923C',
    fondAlerte: '#3B2311',
    danger: '#F87171',
    fondDanger: '#3D1717',
    fond: '#0F1220',
    carte: '#191D31',
    texte: '#E8EAF6',
    texteDiscret: '#A0A5C0',
    bordure: '#2A3050',
    enTete: '#161B33',
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

/** Couleurs complètes de la charte, selon le mode clair ou sombre de l'appareil. */
export function useCouleurs(): Couleurs {
  return useColorScheme() === 'dark' ? MARQUE.sombre : MARQUE.clair;
}

/** Ombre douce des cartes et boutons (iOS, web) ; élévation sur Android. */
export const ombre = (couleur: string, hauteur = 2) => ({
  shadowColor: couleur,
  shadowOpacity: 0.08,
  shadowRadius: hauteur * 4,
  shadowOffset: { width: 0, height: hauteur },
  elevation: hauteur,
});
