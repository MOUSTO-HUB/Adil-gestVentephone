import { jourLocal, peutGererSessions } from '@gestvente/commun';
import { produitsSousSeuil } from './achats';
import { useSession } from './session';
import { useLecture, useSync } from './sync/contexte';

/**
 * Pastilles des menus (accueil, barre d'onglets, écran Menu) : ce qui attend une action
 * dans la boutique choisie. Lues dans la base locale, donc à jour même hors ligne.
 */
export function useCompteurs() {
  const { profil, boutique } = useSession();
  const { etat, conflits } = useSync();
  const boutiqueId = boutique?.id ?? '';
  const gestion = !!profil && peutGererSessions(profil.role);

  const sousSeuil = useLecture((base) => produitsSousSeuil(base, boutiqueId), [boutiqueId]);
  const caissesAValider = useLecture(
    async (base) =>
      gestion
        ? ((
            await base.premier<{ nombre: number }>(
              "SELECT COUNT(*) AS nombre FROM caisse WHERE boutiqueId = ? AND statut = 'CLOTUREE'",
              [boutiqueId],
            )
          )?.nombre ?? 0)
        : 0,
    [boutiqueId, gestion],
  );
  // Transferts qui attendent cette boutique : à recevoir, ou demandes à préparer.
  const transferts = useLecture(
    async (base) =>
      (
        await base.premier<{ nombre: number }>(
          `SELECT COUNT(*) AS nombre FROM transfert
            WHERE (boutiqueArriveeId = ? AND statut = 'ENVOYE')
               OR (boutiqueDepartId = ? AND statut = 'DEMANDE')`,
          [boutiqueId, boutiqueId],
        )
      )?.nombre ?? 0,
    [boutiqueId],
  );
  // Crédits avec une tranche échue non payée.
  const creditsEnRetard = useLecture(
    async (base) =>
      (
        await base.premier<{ nombre: number }>(
          `SELECT COUNT(DISTINCT cr.id) AS nombre FROM credit cr
             JOIN echeance e ON e.creditId = cr.id
            WHERE cr.boutiqueId = ? AND cr.statut = 'EN_COURS'
              AND e.dateEcheance < ? AND e.montantPaye < e.montant + e.penalite`,
          [boutiqueId, jourLocal(new Date(), profil?.commerce.fuseau ?? 'Africa/Conakry')],
        )
      )?.nombre ?? 0,
    [boutiqueId],
  );

  const aVerifier = etat.refusees + (gestion ? conflits : etat.enConflit);
  return {
    gestion,
    sousSeuil,
    stockBas: sousSeuil?.length ?? 0,
    caissesAValider: caissesAValider ?? 0,
    transferts: transferts ?? 0,
    creditsEnRetard: creditsEnRetard ?? 0,
    aVerifier,
    /** Opérations en attente d'envoi ou à vérifier (écran Synchronisation). */
    synchronisation: etat.enAttente + aVerifier,
  };
}
