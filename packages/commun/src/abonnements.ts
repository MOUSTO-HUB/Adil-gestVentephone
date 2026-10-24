/**
 * Abonnement des commerçants à la plateforme (montants en GNF) : formules mensuelle et
 * annuelle, prix selon le nombre de boutiques, période d'essai, délai de grâce, état.
 */

export const FORMULES_ABONNEMENT = ['MENSUELLE', 'ANNUELLE'] as const;
export type FormuleAbonnement = (typeof FORMULES_ABONNEMENT)[number];

export const LIBELLES_FORMULES: Record<FormuleAbonnement, string> = {
  MENSUELLE: 'Mensuelle',
  ANNUELLE: 'Annuelle (2 mois offerts)',
};

export const TARIFS_ABONNEMENT = {
  /** Par mois, première boutique comprise. */
  mensuelBase: 150_000,
  /** Par mois et par boutique supplémentaire. */
  boutiqueSupplementaire: 50_000,
  /** L'année coûte 10 mois. */
  moisFacturesParAn: 10,
} as const;

/** Essai offert à la création d'un commerce. */
export const ESSAI_JOURS = 30;
/** Après l'échéance, l'accès reste ouvert ce nombre de jours (avertissement), puis il est coupé. */
export const GRACE_JOURS = 7;
/** En deçà de ce nombre de jours, le propriétaire est prévenu. */
export const PREAVIS_JOURS = 7;

const JOUR_MS = 86_400_000;

/** Prix d'une période (mois ou année) selon le nombre de boutiques ouvertes. */
export function prixPeriode(formule: FormuleAbonnement, boutiques: number): number {
  const mensuel =
    TARIFS_ABONNEMENT.mensuelBase +
    Math.max(0, boutiques - 1) * TARIFS_ABONNEMENT.boutiqueSupplementaire;
  return formule === 'MENSUELLE' ? mensuel : mensuel * TARIFS_ABONNEMENT.moisFacturesParAn;
}

/** Ajoute des mois à une date (le 31 devient le dernier jour du mois s'il n'existe pas). */
function ajouterMois(date: Date, mois: number): Date {
  const resultat = new Date(date);
  const jour = resultat.getUTCDate();
  resultat.setUTCDate(1);
  resultat.setUTCMonth(resultat.getUTCMonth() + mois);
  const dernier = new Date(
    Date.UTC(resultat.getUTCFullYear(), resultat.getUTCMonth() + 1, 0),
  ).getUTCDate();
  resultat.setUTCDate(Math.min(jour, dernier));
  return resultat;
}

/**
 * Période couverte par un paiement : elle commence à l'échéance en cours si
 * l'abonnement court encore (rien n'est perdu en payant d'avance), sinon maintenant.
 */
export function prolongation(
  jusquAu: Date | null,
  maintenant: Date,
  formule: FormuleAbonnement,
  periodes: number,
): { du: Date; au: Date } {
  const du = jusquAu && jusquAu > maintenant ? jusquAu : maintenant;
  return { du, au: ajouterMois(du, (formule === 'MENSUELLE' ? 1 : 12) * periodes) };
}

/** Fin de la période d'essai à partir de la création. */
export const finEssai = (creation: Date) => new Date(creation.getTime() + ESSAI_JOURS * JOUR_MS);

export type EtatAbonnement =
  'ILLIMITE' | 'ESSAI' | 'ACTIF' | 'A_RENOUVELER' | 'EN_GRACE' | 'EXPIRE';

export const LIBELLES_ETATS_ABONNEMENT: Record<EtatAbonnement, string> = {
  ILLIMITE: 'Sans échéance',
  ESSAI: 'Essai gratuit',
  ACTIF: 'Abonné',
  A_RENOUVELER: 'À renouveler',
  EN_GRACE: 'Échu (délai de grâce)',
  EXPIRE: 'Expiré',
};

/**
 * État de l'abonnement à une date. Sans échéance : accès sans limite (commerce géré à
 * la main). Expiré (échéance + délai de grâce dépassés) : accès coupé, données gardées.
 */
export function etatAbonnement(
  jusquAu: Date | null,
  essaiJusquAu: Date | null,
  maintenant: Date,
): { etat: EtatAbonnement; joursRestants: number | null } {
  if (!jusquAu) return { etat: 'ILLIMITE', joursRestants: null };
  const joursRestants = Math.ceil((jusquAu.getTime() - maintenant.getTime()) / JOUR_MS);
  if (joursRestants <= -GRACE_JOURS) return { etat: 'EXPIRE', joursRestants };
  if (joursRestants <= 0) return { etat: 'EN_GRACE', joursRestants };
  if (essaiJusquAu && essaiJusquAu.getTime() >= jusquAu.getTime()) {
    return { etat: 'ESSAI', joursRestants };
  }
  return { etat: joursRestants <= PREAVIS_JOURS ? 'A_RENOUVELER' : 'ACTIF', joursRestants };
}

/** Message montré au commerçant dont l'abonnement est expiré (accès coupé). */
export function messageAbonnementExpire(jusquAu: Date): string {
  const date = jusquAu.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  return `L'abonnement de votre commerce a pris fin le ${date}. Vos données sont conservées : contactez GestVente pour le renouveler.`;
}

/**
 * Avertissement montré au propriétaire à l'approche de l'échéance (essai compris) et
 * pendant le délai de grâce ; null s'il n'y a rien à dire.
 */
export function avertissementAbonnement(
  jusquAu: Date | null,
  essai: boolean,
  maintenant: Date,
): { niveau: 'info' | 'erreur'; texte: string } | null {
  if (!jusquAu) return null;
  const { etat, joursRestants } = etatAbonnement(jusquAu, essai ? jusquAu : null, maintenant);
  const date = (d: Date) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  if (etat === 'EN_GRACE' || etat === 'EXPIRE') {
    const coupure = new Date(jusquAu.getTime() + GRACE_JOURS * JOUR_MS);
    return {
      niveau: 'erreur',
      texte: `L'abonnement a pris fin le ${date(jusquAu)}. Sans renouvellement, l'accès sera coupé le ${date(coupure)} (vos données sont conservées). Contactez GestVente.`,
    };
  }
  if (joursRestants === null || joursRestants > PREAVIS_JOURS) return null;
  const dans = joursRestants === 1 ? 'demain' : `dans ${joursRestants} jours`;
  return {
    niveau: 'info',
    texte:
      etat === 'ESSAI'
        ? `Votre essai gratuit se termine ${dans} (${date(jusquAu)}). Contactez GestVente pour vous abonner.`
        : `Votre abonnement prend fin ${dans} (${date(jusquAu)}). Contactez GestVente pour le renouveler.`,
  };
}
