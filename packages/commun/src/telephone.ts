/** Numéros de téléphone au format international E.164 (+224…). */

export const INDICATIF_PAR_DEFAUT = '+224';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Numéro saisi → E.164. Espaces, points, tirets et parenthèses sont ignorés ;
 * « 00 » devient « + » ; un numéro sans indicatif reçoit celui du commerce.
 * Renvoie null si le résultat n'est pas un numéro valide.
 */
export function normaliserTelephone(
  saisie: string,
  indicatif = INDICATIF_PAR_DEFAUT,
): string | null {
  let numero = saisie.replace(/[\s.\-() ]/g, '');
  if (!numero) return null;
  if (numero.startsWith('00')) numero = `+${numero.slice(2)}`;
  if (!numero.startsWith('+')) numero = `${indicatif}${numero}`;
  return E164.test(numero) ? numero : null;
}

export const telephoneValide = (numero: string) => E164.test(numero);

/** Affichage lisible : « +224 620 11 22 33 » (groupes de 3 puis de 2 chiffres). */
export function formaterTelephone(numero: string, indicatif = INDICATIF_PAR_DEFAUT): string {
  if (!numero.startsWith(indicatif)) return numero;
  const national = numero.slice(indicatif.length);
  const tete = national.slice(0, 3);
  const reste = national.slice(3).match(/.{1,2}/g) ?? [];
  return [indicatif, tete, ...reste].join(' ');
}
