/** Un IMEI : 15 chiffres dont le dernier est la clé de Luhn. */
const FORMAT_IMEI = /^\d{15}$/;

/** Clé de Luhn (0 à 9) des chiffres donnés, à ajouter en dernière position. */
export function cleLuhn(chiffres: string): number {
  if (!/^\d+$/.test(chiffres)) {
    throw new RangeError(`Chiffres attendus : ${chiffres}`);
  }
  let somme = 0;
  // En partant de la droite, un chiffre sur deux est doublé (en commençant par
  // celui qui précédera la clé).
  for (let i = 0; i < chiffres.length; i++) {
    let chiffre = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 0) {
      chiffre *= 2;
      if (chiffre > 9) chiffre -= 9;
    }
    somme += chiffre;
  }
  return (10 - (somme % 10)) % 10;
}

/** Vrai si la valeur (espaces et tirets ignorés) est un IMEI de 15 chiffres à clé valide. */
export function imeiValide(valeur: string): boolean {
  const imei = normaliserImei(valeur);
  return FORMAT_IMEI.test(imei) && cleLuhn(imei.slice(0, 14)) === Number(imei[14]);
}

/** Retire les espaces et tirets saisis ou lus par un lecteur. */
export function normaliserImei(valeur: string): string {
  return valeur.replace(/[\s-]/g, '');
}

/** Complète 14 chiffres avec leur clé de Luhn pour former un IMEI. */
export function completerImei(quatorzeChiffres: string): string {
  if (!/^\d{14}$/.test(quatorzeChiffres)) {
    throw new RangeError(`14 chiffres attendus : ${quatorzeChiffres}`);
  }
  return `${quatorzeChiffres}${cleLuhn(quatorzeChiffres)}`;
}
