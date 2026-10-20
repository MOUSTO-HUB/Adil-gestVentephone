import {
  bilanCaisse,
  type CaisseSync,
  ecartsCaisse,
  type Montants,
  type MouvementsCaisse,
  type MoyenPaiement,
  type MoyenRemboursement,
  type RapportCaisse,
} from '@gestvente/commun';
import type { BaseSql } from './base/sql';

/** Caisse lue dans la base locale (comptage et attendu gardés en JSON). */
type LigneCaisse = Omit<CaisseSync, 'comptage' | 'theorique'> & {
  comptage: string | null;
  theorique: string | null;
};

const lireMontants = (json: string | null): Montants | null =>
  json ? (JSON.parse(json) as Montants) : null;

export async function lireCaisse(base: BaseSql, id: string): Promise<CaisseSync | null> {
  const c = await base.premier<LigneCaisse>('SELECT * FROM caisse WHERE id = ?', [id]);
  return c
    ? { ...c, comptage: lireMontants(c.comptage), theorique: lireMontants(c.theorique) }
    : null;
}

/** La caisse ouverte de l'utilisateur dans la boutique (une seule à la fois). */
export async function caisseOuverte(
  base: BaseSql,
  boutiqueId: string,
  utilisateurId: string,
): Promise<CaisseSync | null> {
  const c = await base.premier<{ id: string }>(
    "SELECT id FROM caisse WHERE boutiqueId = ? AND utilisateurId = ? AND statut = 'OUVERTE' ORDER BY ouverteLe DESC LIMIT 1",
    [boutiqueId, utilisateurId],
  );
  return c ? lireCaisse(base, c.id) : null;
}

/** Ventes, remboursements et dépenses de la caisse, d'après la base de l'appareil. */
export async function mouvementsCaisse(base: BaseSql, caisseId: string): Promise<MouvementsCaisse> {
  const caisse = await base.premier<{ fondInitial: number }>(
    'SELECT fondInitial FROM caisse WHERE id = ?',
    [caisseId],
  );
  const ventes = await base.tous<{
    id: string;
    statut: 'VALIDEE' | 'ANNULEE';
    renduMonnaie: number;
  }>('SELECT id, statut, renduMonnaie FROM vente WHERE caisseId = ?', [caisseId]);
  const paiements = await base.tous<{ venteId: string; moyen: MoyenPaiement; montant: number }>(
    'SELECT p.venteId, p.moyen, p.montant FROM paiementVente p JOIN vente v ON v.id = p.venteId WHERE v.caisseId = ?',
    [caisseId],
  );
  return {
    fondInitial: caisse?.fondInitial ?? 0,
    ventes: ventes.map((v) => ({
      statut: v.statut,
      renduMonnaie: v.renduMonnaie,
      paiements: paiements.filter((p) => p.venteId === v.id),
    })),
    retours: await base.tous<{
      montantRembourse: number;
      moyenRemboursement: MoyenRemboursement | null;
    }>('SELECT montantRembourse, moyenRemboursement FROM retour WHERE caisseId = ?', [caisseId]),
    depenses: await base.tous<{ montant: number; moyen: MoyenRemboursement }>(
      'SELECT montant, moyen FROM depense WHERE caisseId = ?',
      [caisseId],
    ),
  };
}

/**
 * Rapport de la caisse : l'attendu enregistré à la clôture (calculé par le serveur)
 * s'il existe, sinon celui de l'appareil.
 */
export async function rapportCaisse(
  base: BaseSql,
  caisse: CaisseSync,
  entete: { commerce: string; boutique: string; monnaie: string; fuseau: string },
): Promise<RapportCaisse> {
  const bilan = bilanCaisse(await mouvementsCaisse(base, caisse.id));
  const theorique = caisse.theorique ?? bilan.theorique;
  const ecarts = caisse.comptage ? ecartsCaisse(theorique, caisse.comptage) : null;
  return {
    ...entete,
    vendeur: caisse.vendeur,
    statut: caisse.statut,
    ouverteLe: caisse.ouverteLe,
    clotureeLe: caisse.clotureeLe,
    fondInitial: caisse.fondInitial,
    nombreVentes: bilan.nombreVentes,
    encaisse: bilan.encaisse,
    rembourse: bilan.rembourse,
    depense: bilan.depense,
    theorique,
    comptage: caisse.comptage,
    ecarts: ecarts?.parMoyen ?? null,
    ecartTotal: caisse.ecart ?? ecarts?.total ?? null,
    commentaire: caisse.commentaire,
    validePar: caisse.validePar,
    commentaireValidation: caisse.commentaireValidation,
  };
}
