import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';

/**
 * Retire les espaces au début et à la fin de toutes les chaînes reçues (corps, paramètres
 * de recherche) : identifiants, mots de passe, noms, numéros… Les objets et tableaux sont
 * parcourus ; les fichiers et autres valeurs ne sont pas touchés.
 */
export function sansEspaces(valeur: unknown): unknown {
  if (typeof valeur === 'string') return valeur.trim();
  if (Array.isArray(valeur)) return valeur.map(sansEspaces);
  if (valeur && typeof valeur === 'object' && Object.getPrototypeOf(valeur) === Object.prototype) {
    return Object.fromEntries(Object.entries(valeur).map(([cle, v]) => [cle, sansEspaces(v)]));
  }
  return valeur;
}

@Injectable()
export class PipeEspaces implements PipeTransform {
  transform(valeur: unknown, meta: ArgumentMetadata) {
    return meta.type === 'body' || meta.type === 'query' ? sansEspaces(valeur) : valeur;
  }
}
