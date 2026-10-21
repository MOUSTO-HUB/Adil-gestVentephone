import {
  type DestinationReprise,
  type EtatComposant,
  type EtatReprise,
  etatGlobal,
  type LigneGrille,
  normaliserImei,
  type TrocSaisi,
  valeurProposee,
} from '@gestvente/commun';
import type { BaseSql } from './base/sql';

/** Saisie du troc sur l'écran de vente (textes tels que tapés). */
export interface FormulaireTroc {
  /** Identifiant du troc, donné dès l'ouverture (autorisation du gérant liée à ce troc). */
  id: string;
  articleId: string;
  produit: { id: string; nom: string } | null;
  imei: string;
  etatEcran: EtatComposant;
  etatBatterie: EtatComposant;
  etatBoitier: EtatComposant;
  fonctionne: boolean;
  note: string;
  valeur: string;
  destination: DestinationReprise;
  prixRevente: string;
  /** Photos prises sur l'appareil, envoyées après la synchronisation. */
  photos: string[];
  autorisation: { jeton: string; gerant: string; valeur: number } | null;
}

export const formulaireTrocVide = (id: string, articleId: string): FormulaireTroc => ({
  id,
  articleId,
  produit: null,
  imei: '',
  etatEcran: 'BON',
  etatBatterie: 'BON',
  etatBoitier: 'BON',
  fonctionne: true,
  note: '',
  valeur: '',
  destination: 'A_REVENDRE',
  prixRevente: '',
  photos: [],
  autorisation: null,
});

export const etatDuFormulaire = (f: FormulaireTroc): EtatReprise =>
  etatGlobal({
    ecran: f.etatEcran,
    batterie: f.etatBatterie,
    boitier: f.etatBoitier,
    fonctionne: f.fonctionne,
  });

/** Montant saisi (espaces ignorés) ; NaN si ce n'est pas un entier. */
export const montantSaisi = (texte: string) => {
  const propre = texte.replace(/[\s  ]/g, '');
  return propre === '' ? 0 : /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

/** Valeur proposée pour l'appareil repris : grille locale, sinon estimation sur le prix du neuf. */
export async function proposerReprise(
  base: BaseSql,
  boutiqueId: string,
  produitId: string,
  etat: EtatReprise,
): Promise<{ valeur: number; source: 'GRILLE' | 'ESTIMATION' } | null> {
  const produit = await base.premier<{
    modeleId: string | null;
    capacite: string | null;
    prixDetail: number;
  }>(
    `SELECT p.modeleId, p.capacite, COALESCE(pb.prixDetail, p.prixDetail) AS prixDetail
       FROM produit p
       LEFT JOIN prixBoutique pb ON pb.produitId = p.id AND pb.boutiqueId = ?
      WHERE p.id = ?`,
    [boutiqueId, produitId],
  );
  if (!produit) return null;
  const grille = produit.modeleId
    ? await base.tous<LigneGrille>(
        'SELECT modeleId, capacite, etat, valeur FROM grilleReprise WHERE modeleId = ?',
        [produit.modeleId],
      )
    : [];
  return valeurProposee(
    grille,
    { modeleId: produit.modeleId, capacite: produit.capacite, prixNeuf: produit.prixDetail },
    etat,
  );
}

/** Troc prêt à joindre à la vente, ou le motif qui empêche de l'enregistrer. */
export function trocDepuisFormulaire(
  f: FormulaireTroc,
  proposee: number,
): { troc: TrocSaisi } | { erreur: string } {
  if (!f.produit) return { erreur: 'Troc : choisissez le modèle de l’appareil repris.' };
  const valeur = montantSaisi(f.valeur);
  if (Number.isNaN(valeur) || valeur <= 0) {
    return { erreur: 'Troc : indiquez la valeur de reprise (nombre entier).' };
  }
  const prixRevente = montantSaisi(f.prixRevente);
  if (f.destination === 'A_REVENDRE' && (Number.isNaN(prixRevente) || prixRevente <= 0)) {
    return { erreur: 'Troc : indiquez le prix de revente de l’appareil repris.' };
  }
  return {
    troc: {
      id: f.id,
      articleId: f.articleId,
      produitId: f.produit.id,
      imei: normaliserImei(f.imei),
      etatEcran: f.etatEcran,
      etatBatterie: f.etatBatterie,
      etatBoitier: f.etatBoitier,
      fonctionne: f.fonctionne,
      note: f.note.trim(),
      valeurProposee: proposee,
      valeurRetenue: valeur,
      destination: f.destination,
      prixRevente: f.destination === 'A_REVENDRE' || prixRevente > 0 ? prixRevente : null,
      autorisation: f.autorisation && valeur <= f.autorisation.valeur ? f.autorisation.jeton : null,
    },
  };
}
