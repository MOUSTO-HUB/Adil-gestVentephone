/** Code PIN de déverrouillage de l'application sur un appareil déjà connecté. */
export const PIN_LONGUEUR_MIN = 4;
export const PIN_LONGUEUR_MAX = 6;
/** Essais avant de devoir se reconnecter avec le mot de passe. */
export const PIN_ESSAIS_MAX = 5;

/**
 * Vérifie un nouveau code PIN. Renvoie le message d'erreur à afficher, ou null
 * si le code est accepté. Refuse les codes trop faciles à deviner (0000, 1234, 9876…).
 */
export function erreurNouveauPin(pin: string): string | null {
  if (!/^\d+$/.test(pin) || pin.length < PIN_LONGUEUR_MIN || pin.length > PIN_LONGUEUR_MAX) {
    return `Le code PIN doit contenir de ${PIN_LONGUEUR_MIN} à ${PIN_LONGUEUR_MAX} chiffres.`;
  }
  const chiffres = [...pin].map(Number);
  const pas = chiffres[1] - chiffres[0];
  const suite = chiffres.every((c, i) => i === 0 || c - chiffres[i - 1] === pas);
  if (suite && Math.abs(pas) <= 1) {
    return 'Code trop facile à deviner : évitez les chiffres identiques ou qui se suivent.';
  }
  return null;
}

export interface EtatPin {
  essaisRestants: number;
  /** Plus d'essai : il faut se reconnecter avec le mot de passe. */
  bloque: boolean;
}

export const ETAT_PIN_INITIAL: EtatPin = { essaisRestants: PIN_ESSAIS_MAX, bloque: false };

/** État après un essai de code PIN : un bon code remet le compteur à zéro. */
export function apresEssaiPin(etat: EtatPin, correct: boolean): EtatPin {
  if (etat.bloque) return etat;
  if (correct) return ETAT_PIN_INITIAL;
  const essaisRestants = Math.max(0, etat.essaisRestants - 1);
  return { essaisRestants, bloque: essaisRestants === 0 };
}
