import { z } from 'zod';

/** Monnaie par défaut d'un commerce (franc guinéen), paramétrable par commerce. */
export const MONNAIE_PAR_DEFAUT = 'GNF';

/** Un montant est toujours un entier positif ou nul dans la monnaie du commerce. */
export const schemaMontant = z.number().int().nonnegative();

/** Affiche un montant entier avec séparateur de milliers : 1 500 000 GNF. */
export function formaterMontant(montant: number, monnaie: string = MONNAIE_PAR_DEFAUT): string {
  if (!Number.isInteger(montant)) {
    throw new RangeError(`Montant non entier : ${montant}`);
  }
  const signe = montant < 0 ? '-' : '';
  const chiffres = Math.abs(montant)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return `${signe}${chiffres} ${monnaie}`;
}
