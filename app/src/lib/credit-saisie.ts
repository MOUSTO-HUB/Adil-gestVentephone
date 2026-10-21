import {
  type CreditSaisi,
  echeancier,
  erreurConditionsCredit,
  type FrequenceCredit,
  premiereEcheanceParDefaut,
} from '@gestvente/commun';

/** Saisie du crédit sur l'écran de vente (textes tels que tapés). */
export interface FormulaireCredit {
  apport: string;
  tranches: string;
  frequence: FrequenceCredit;
  /** JJ/MM/AAAA. */
  premiere: string;
  avecGarant: boolean;
}

const versFr = (jour: string) => jour.split('-').reverse().join('/');

export const formulaireCreditVide = (aujourdhui: string): FormulaireCredit => ({
  apport: '',
  tranches: '3',
  frequence: 'MENSUELLE',
  premiere: versFr(premiereEcheanceParDefaut(aujourdhui, 'MENSUELLE')),
  avecGarant: true,
});

/** JJ/MM/AAAA → AAAA-MM-JJ (null si la date n'existe pas). */
export function jourSaisi(texte: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texte.trim());
  if (!m) return null;
  const jour = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const date = new Date(`${jour}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== jour ? null : jour;
}

const entier = (texte: string) => {
  const propre = texte.replace(/[\s  ]/g, '');
  return propre === '' ? 0 : /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

/**
 * Crédit prêt à joindre à la vente (total après remise et reprise), ou le motif qui
 * empêche de l'enregistrer.
 */
export function creditDepuisFormulaire(
  f: FormulaireCredit,
  total: number,
  aujourdhui: string,
  garantId: string | null,
  creerId: () => string,
): { credit: CreditSaisi; tranches: ReturnType<typeof echeancier> } | { erreur: string } {
  const apport = entier(f.apport);
  const nombre = entier(f.tranches);
  if (Number.isNaN(apport)) return { erreur: 'Apport : nombre entier attendu.' };
  if (Number.isNaN(nombre)) return { erreur: 'Nombre de tranches : entier attendu.' };
  const conditions = erreurConditionsCredit(total, apport, nombre);
  if (conditions) return { erreur: conditions };
  const premiere = jourSaisi(f.premiere);
  if (!premiere) return { erreur: 'Première échéance : date au format JJ/MM/AAAA.' };
  if (premiere <= aujourdhui)
    return { erreur: 'La première échéance doit être après aujourd’hui.' };
  return {
    credit: {
      id: creerId(),
      apport,
      nombreTranches: nombre,
      frequence: f.frequence,
      premiereEcheance: premiere,
      garantId: f.avecGarant ? garantId : null,
      echeanceIds: Array.from({ length: nombre }, creerId),
    },
    tranches: echeancier(total - apport, nombre, f.frequence, premiere),
  };
}
