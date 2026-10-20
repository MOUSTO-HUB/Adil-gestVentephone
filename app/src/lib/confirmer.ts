import { Alert, Platform } from 'react-native';

/** Confirmation avant une action irréversible (boîte native, ou du navigateur sur le web). */
export function confirmer(message: string, action = 'Confirmer'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resoudre) =>
    Alert.alert('Confirmation', message, [
      { text: 'Annuler', style: 'cancel', onPress: () => resoudre(false) },
      { text: action, style: 'destructive', onPress: () => resoudre(true) },
    ]),
  );
}
